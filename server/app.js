// app.js

// Зависимости
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { send } from './utils.js';
import { restoreGame, saveGame, deleteGame, ensureGamesFolder } from './fsGames.js';

// Настройки
// const PORT = 3012;
const PORT = process.env.PORT || 3000;

// Хранилище сессий в памяти
const sessions = {}; // secret_id → { sockets: { player1, player2 } }
// Очередь операций для каждой сессии
const sessionQueues = {};

// Обёртка для последовательного выполнения async-операций в конкретной сессии.
function queueSessionOp(secret_id, op) {
  if (!sessionQueues[secret_id]) sessionQueues[secret_id] = [];
  const queue = sessionQueues[secret_id];

  return new Promise((resolve, reject) => {
    const run = async () => {
      try {
        const result = await op();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        queue.shift();
        if (queue.length) queue[0]();         // запускаем следующую
        else delete sessionQueues[secret_id]; // чистим очередь
      }
    };

    queue.push(run);
    if (queue.length === 1) run();            // если очередь была пуста — стартуем
  });
}

async function postProcessMessage(type, ws, session, secret_id) {
  // Привязываем сокет к сессии
  ws.secret_id = secret_id;
  session.sockets[ws.role] = ws;
  log(`Назначена роль ${ws.role} в сессии ${secret_id}`, 'info');

  // Отправляем роль клиенту
  ws.send(JSON.stringify({ type: 'role_assigned', role: ws.role }));

  const p1 = session.sockets.player1;
  const p2 = session.sockets.player2;
  const both = Boolean(p1 && p2);

  if (type === 'connect') {
    if (both) {
      log(`Оба игрока подключены: ${secret_id}`, 'info');
      p1.send(JSON.stringify({ type: 'connected' }));
      p2.send(JSON.stringify({ type: 'connected' }));
    } else {
      ws.send(JSON.stringify({ type: 'waiting' }));
    }

  } else {
    // reconnect
    if (both) {
      log(`Сессия восстановлена: ${secret_id}`, 'info');
      p1.send(JSON.stringify({ type: 'resume' }));
      p2.send(JSON.stringify({ type: 'resume' }));
    } else {
      ws.send(JSON.stringify({ type: 'waiting' }));
    }
  }

  // === Универсальная проверка: если оба флота уже сохранены ===
  if (session.battleData?.player1 && session.battleData?.player2 && both) {
    log(`Рестарт боя для сессии ${secret_id}`, 'info');
    ['player1', 'player2'].forEach(roleKey => {
      session.sockets[roleKey].send(JSON.stringify({
        type: 'battle',
        initialFleet: session.initialFleets[roleKey],
        battle_ready: true,
        turn: session.battleData.turn,
        shots: session.battleData.shots
      }));
    });
  }
}

// Гарантированно возвращает объект сессии, создавая при необходимости.
function getSession(secret_id) {
  if (!sessions[secret_id]) {
    sessions[secret_id] = {
      playerIds: { player1: null, player2: null },
      sockets: { player1: null, player2: null }
    };
  }
  return sessions[secret_id];
}

// Логирование
function log(msg, level = 'info') {
  const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
  console.log(`[${ts}] [${level}] ${msg}`);
}

// Убедимся, что папка игр существует или создадим ее
await ensureGamesFolder();

// Express + фронт
const app = express();
app.use(express.static('public'));
const server = app.listen(PORT, () =>
  log(`Сервер слушает http://localhost:${PORT}`, 'init')
);

// WebSocket-сервер
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  log('→ Новое WebSocket-подключение');

  // Добавим состояние сокету
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.role = null;
  ws.secret_id = null;

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      log('Некорректный JSON', 'warn');
      return;
    }

    const { type, secret_id, role: clientRole, playerId } = data;
    log(`← Получено сообщение ${type}`, 'debug');

    if (!secret_id) {
      ws.send(JSON.stringify({ type: 'error', message: 'secret_id обязателен' }));
      return;
    }

    // Инициализация сессии при необходимости
    if (!sessions[secret_id]) {
      sessions[secret_id] = {
        sockets: { player1: null, player2: null },
        lastActive: Date.now()
      };
      log(`Создана новая сессия ${secret_id}`, 'debug');
    }
    const session = sessions[secret_id];
    session.lastActive = Date.now();

    // Инициализируем mapping playerIds, если нужно
    session.playerIds = session.playerIds || { player1: null, player2: null };

    switch (type) {

      case 'connect':
        await queueSessionOp(secret_id, async () => {
          const session = getSession(secret_id);

          // Сбрасываем «мертвые» сокеты (если readyState CLOSED)
          for (const role of ['player1', 'player2']) {
            const s = session.sockets[role];
            if (s && s.readyState === WebSocket.CLOSED) {
              session.sockets[role] = null;
            }
          }

          // Определяем, куда встать этому playerId
          let assignedRole = null;

          // Вернуть старую роль, если он был здесь и сейчас нет активного сокета
          if (session.playerIds.player1 === playerId && !session.sockets.player1) {
            assignedRole = 'player1';
          }
          else if (session.playerIds.player2 === playerId && !session.sockets.player2) {
            assignedRole = 'player2';
          }
          // Новый игрок — первый свободный слот
          else if (!session.sockets.player1) {
            assignedRole = 'player1';
            session.playerIds.player1 = playerId;
          }
          else if (!session.sockets.player2) {
            assignedRole = 'player2';
            session.playerIds.player2 = playerId;
          }
          else {
            // оба слота заняты
            return ws.send(JSON.stringify({
              type: 'error',
              message: 'Комната заполнена'
            }));
          }

          // Привязываем сокет и данные
          ws.role = assignedRole;
          ws.playerId = playerId;
          ws.secret_id = secret_id;

          session.sockets[assignedRole] = ws;

          // Восстанавливаем игру (если нужно) и уведомляем клиента
          await restoreGame(session, secret_id);
          await postProcessMessage(type, ws, session, secret_id);
        });
        
        return;


      case 'reconnect':
        await queueSessionOp(secret_id, async () => {
          const session = getSession(secret_id);
          const role = clientRole; // из body: 'player1' или 'player2'

          // Валидация
          if (!['player1', 'player2'].includes(role) ||
            session.playerIds[role] !== playerId) {
            return ws.send(JSON.stringify({
              type: 'error',
              message: 'Невозможен reconnect: неверная роль или playerId'
            }));
          }

          // Закрываем прежний сокет для этой роли, если он ещё жив
          const old = session.sockets[role];
          if (old && old.readyState !== WebSocket.CLOSED) {
            old.close();
          }

          // Привязанная работа сессии
          ws.role = role;
          ws.playerId = playerId;
          ws.secret_id = secret_id;
          session.sockets[role] = ws;

          // Восстанавливаем состояние и отвечаем
          await restoreGame(session, secret_id);
          await postProcessMessage(type, ws, session, secret_id);
        });

        return;

      case 'battle_start':
        await queueSessionOp(secret_id, async () => {
          log(`battle_start от ${ws.role} в сессии ${secret_id}`, 'info');

          session.battleData = session.battleData || {};
          session.battleData[ws.role] = data.fleet;
          session.battleData.shots = session.battleData.shots || [];

          await saveGame(secret_id, session.battleData);
          log(`Данные игрока ${ws.role} сохранены`, 'debug');

          if (session.battleData.player1 && session.battleData.player2) {
            session.battleData.turn = session.battleData.turn || 'player1';
            session.initialFleets = {
              player1: structuredClone(session.battleData.player1),
              player2: structuredClone(session.battleData.player2),
            };
            session.battleData.initialFleets = session.initialFleets;

            await saveGame(secret_id, session.battleData);
            log(`Оба игрока готовы. Бой начинается: ${secret_id}, ходит ${session.battleData.turn}`, 'info');

            ['player1', 'player2'].forEach(roleKey => {
              send(session.sockets[roleKey], {
                type: 'battle',
                initialFleet: session.initialFleets[roleKey],
                battle_ready: true,
                turn: session.battleData.turn,
                shots: session.battleData.shots,
              });
            });
          }
        });
        return;

      case 'shoot':
        await queueSessionOp(secret_id, async () => {
          const { x, y } = data;
          const session = sessions[secret_id];
          const bd = session.battleData;

          if (bd.turn !== ws.role) return;

          // Логика попадания
          const enemyRole = ws.role === 'player1' ? 'player2' : 'player1';
          const enemyFleet = bd[enemyRole];
          let isHit = false, sunk = null;

          for (const [shipName, coords] of Object.entries(enemyFleet)) {
            const idx = coords.findIndex(p => p.x === x && p.y === y);
            if (idx !== -1) {
              isHit = true;
              coords.splice(idx, 1);
              if (coords.length === 0) {
                sunk = { ship: shipName, coords: session.initialFleets[enemyRole][shipName] };
                log(`→ Корабль ${shipName} потоплен!`, 'info');
              }
              break;
            }
          }

          const gameOver = Object.values(enemyFleet).every(c => c.length === 0);
          if (!isHit && !gameOver) bd.turn = enemyRole;

          const result = { type: 'shot_result', x, y, isHit, by: ws.role, turn: bd.turn };
          if (sunk) result.sunk = sunk;
          if (gameOver) { result.gameOver = true; result.winner = ws.role; }

          bd.shots.push({ x, y, isHit, by: ws.role, sunk: sunk || null, gameOver, winner: gameOver ? ws.role : null });

          if (gameOver) {
            await deleteGame(secret_id);
            delete sessions[secret_id];
            log(`Игра ${secret_id} окончена, файл удалён`, 'info');
          } else {
            await saveGame(secret_id, bd);
            log(`Игра ${secret_id} обновлена после выстрела`, 'debug');
          }

          send(session.sockets.player1, result);
          send(session.sockets.player2, result);
        });
        return;

      case 'chat': {
        const { text } = data;
        if (typeof text !== 'string' || !ws.secret_id) return;
        const session = sessions[ws.secret_id];
        if (!session) return;

        const payload = {
          type: 'chat',
          from: ws.role,
          text: text.slice(0, 500) // обрезаем слишком длинные сообщения
        };

        // Рассылаем обоим (если подключены)
        ['player1', 'player2'].forEach(roleKey => {
          const sock = session.sockets[roleKey];
          if (sock && sock.readyState === sock.OPEN) {
            sock.send(JSON.stringify(payload));
          }
        });
        return;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Неизвестный тип' }));
        return;
    }
  });

  ws.on('close', () => {
    // Последовательная обработка в рамках одной сессии
    queueSessionOp(ws.secret_id, () => {
      const session = sessions[ws.secret_id];
      if (!session) return;

      // Если это один из игроков и сокет совпал с хранимым
      if (ws.role && session.sockets[ws.role] === ws) {
        // освобождаем слот
        session.sockets[ws.role] = null;

        // определяем «другого» игрока
        const otherRole = ws.role === 'player1' ? 'player2' : 'player1';
        const other = session.sockets[otherRole];

        // Если второй игрок всё ещё на связи — отправляем pause
        if (other && other.readyState === WebSocket.OPEN) {
          other.send(JSON.stringify({ type: 'pause' }));
        }
      }
    });
  });


});

const SESSION_TTL = 5 * 60 * 1000; // 5 минут
const GC_INTERVAL = 60 * 1000;     // 1 минута

// Удаление мертвых сессий
setInterval(() => {
  const now = Date.now();
  for (const [secret_id, session] of Object.entries(sessions)) {
    const hasLiveSocket = ['player1', 'player2'].some(
      role => session.sockets[role]?.readyState === WebSocket.OPEN
    );

    if (!hasLiveSocket && (now - session.lastActive) > SESSION_TTL) {
      log(`Удаляем сессию ${secret_id}`, 'info');
      delete sessions[secret_id];
    }
  }
}, GC_INTERVAL);

// Регулярный heartbeat для всех сокетов
const HEARTBEAT_INTERVAL = 30 * 1000;
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);
