// app.js
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { send, queueSessionOp, postProcessMessage, getSession, log, startSessionGarbageCollector, startWebSocketHeartbeat } from './utils.js';
import { restoreGame, saveGame, deleteGame, ensureGamesFolder } from './fsGames.js';

const PORT = process.env.PORT || 3000;
const sessions = {}; // Хранилище сессий в памяти, secret_id → { sockets: { player1, player2 } }
const sessionQueues = {}; // Очередь операций для каждой сессии
const SESSION_TTL = 5 * 60 * 1000; // 5 минут
const GC_INTERVAL = 60 * 1000;     // 1 минута
const HEARTBEAT_INTERVAL = 30 * 1000; // 30 сек

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
    try {
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
        send(ws, { type: 'error', message: 'secret_id обязателен' });
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
          try {
            await queueSessionOp(secret_id, async () => {
              const session = getSession(secret_id, sessions);

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
                send(ws, { type: 'error', message: 'Комната заполнена' });
                return;
              }

              // Привязываем сокет и данные
              ws.role = assignedRole;
              ws.playerId = playerId;
              ws.secret_id = secret_id;

              session.sockets[assignedRole] = ws;

              // Восстанавливаем игру (если нужно) и уведомляем клиента
              await restoreGame(session, secret_id);
              await postProcessMessage(type, ws, session, secret_id);
            }, sessionQueues);
          } catch (err) {
            log(`Ошибка обработки ${type} в сессии ${secret_id}: ${err}`, 'error');
            send(ws, { type: 'error', message: 'Internal server error' });
          }
          return;


        case 'reconnect':
          try {
            await queueSessionOp(secret_id, async () => {
              const session = getSession(secret_id, sessions);
              const role = clientRole; // из body: 'player1' или 'player2'

              // Валидация
              if (!['player1', 'player2'].includes(role) ||
                session.playerIds[role] !== playerId) {
                send(ws, {
                  type: 'error',
                  message: 'Невозможен reconnect: неверная роль или playerId'
                });
                return;
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
            }, sessionQueues);
          } catch (err) {
            log(`Ошибка обработки ${type} в сессии ${secret_id}: ${err}`, 'error');
            send(ws, { type: 'error', message: 'Internal server error' });
          }
          return;

        case 'battle_start':
          try {
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
            }, sessionQueues);
          } catch (err) {
            log(`Ошибка обработки ${type} в сессии ${secret_id}: ${err}`, 'error');
            send(ws, { type: 'error', message: 'Internal server error' });
          }
          return;

        case 'shoot':
          try {
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
            }, sessionQueues);
          } catch (err) {
            log(`Ошибка обработки ${type} в сессии ${secret_id}: ${err}`, 'error');
            send(ws, { type: 'error', message: 'Internal server error' });
          }
          return;

        default:
          send(ws, { type: 'error', message: 'Неизвестный тип' });
          return;
      }
    } catch (err) {
      // если JSON.parse или любая логика упала
      log(`Ошибка в сообщении от клиента: ${err}`, 'error');
      send(ws, { type: 'error', message: 'Internal server error' });
    }
  });

  ws.on('close', () => {
    if (!ws.secret_id) return;
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
        if (other) {
          send(other, { type: 'pause' });
        }
      }
    }, sessionQueues);
  });
});

startSessionGarbageCollector(GC_INTERVAL, SESSION_TTL, sessions, WebSocket);
startWebSocketHeartbeat(wss, HEARTBEAT_INTERVAL);
