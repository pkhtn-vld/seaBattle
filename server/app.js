// app.js

// Зависимости
import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { send } from './utils.js';

// Настройки
// const PORT = 3012;
const PORT = process.env.PORT || 3000;
const GAMES_FOLDER = path.join('./server/games');

// Хранилище сессий в памяти
const sessions = {}; // secret_id → { sockets: { player1, player2 } }

// Логирование
function log(msg, level = 'info') {
  const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
  console.log(`[${ts}] [${level}] ${msg}`);
}

// Убедимся, что папка игр существует
if (!fs.existsSync(GAMES_FOLDER)) {
  fs.mkdirSync(GAMES_FOLDER, { recursive: true });
  log('Создана папка games', 'init');
}

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
  ws.role = null;
  ws.secret_id = null;

  ws.on('message', (raw) => {
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
      sessions[secret_id] = { sockets: { player1: null, player2: null } };
      log(`Создана новая сессия ${secret_id}`, 'debug');
    }
    const session = sessions[secret_id];

    // Инициализируем mapping playerIds, если нужно
    session.playerIds = session.playerIds || { player1: null, player2: null };

    switch (type) {

      case 'connect':
        // Назначаем роль
        // Если уже был этот playerId — восстанавливаем роль
        if (session.playerIds.player1 === playerId) {
          ws.role = 'player1';
        } else if (session.playerIds.player2 === playerId) {
          ws.role = 'player2';
        } else {
          // Новый игрок — даём первую свободную роль
          ws.role = session.sockets.player1 ? 'player2' : 'player1';
          session.playerIds[ws.role] = playerId;
        }
        ws.playerId = playerId;

        // Подгружаем battleData из файла, если оба флота там есть
        {
          const file = path.join(GAMES_FOLDER, `${secret_id}.json`);
          if (fs.existsSync(file)) {
            const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (saved.player1 && saved.player2) {
              session.battleData = saved;
              session.initialFleets = {
                player1: JSON.parse(JSON.stringify(saved.player1)),
                player2: JSON.parse(JSON.stringify(saved.player2))
              };
              log(`Подгружены флоты из файла для ${ws.role}`, 'info');
            }
          }
        }
        break;

      case 'reconnect':
        // Проверяем роль
        if (!['player1', 'player2'].includes(clientRole) ||
          session.playerIds[clientRole] !== playerId) {
          // ws.send(JSON.stringify({ type: 'error', message: 'Некорректная роль' }));
          return;
        }
        // Восстанавливаем
        ws.role = clientRole;
        ws.playerId = playerId;
        session.playerIds[ws.role] = playerId;

        // Подгружаем battleData из файла
        {
          const file = path.join(GAMES_FOLDER, `${secret_id}.json`);
          if (fs.existsSync(file)) {
            const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (saved.player1 && saved.player2) {
              session.battleData = saved;
              session.initialFleets = {
                player1: JSON.parse(JSON.stringify(saved.player1)),
                player2: JSON.parse(JSON.stringify(saved.player2))
              };
              log(`Подгружены флоты из файла для ${ws.role}`, 'info');
            }
          }
        }
        break;

      case 'battle_start':
        log(`battle_start от ${ws.role} в сессии ${secret_id}`, 'info');

        // Инициализируем battleData, если её нет
        session.battleData = session.battleData || {};
        session.battleData[ws.role] = data.fleet; // сохраняем данные флота
        // Инициализируем историю выстрелов, если нужно
        session.battleData.shots = session.battleData.shots || [];

        // Сохраняем на диск
        fs.writeFileSync(
          path.join(GAMES_FOLDER, `${secret_id}.json`),
          JSON.stringify(session.battleData, null, 2)
        );
        log(`Данные игрока ${ws.role} сохранены`, 'debug');

        // Если оба игрока прислали данные — начинаем бой
        if (session.battleData.player1 && session.battleData.player2) {
          // Выбираем, кто ходит первым
          session.battleData.turn = session.battleData.turn || 'player1';

          // Сохраняем чистую копию каждого флота для определения sunk‑coords
          session.initialFleets = {
            player1: JSON.parse(JSON.stringify(session.battleData.player1)),
            player2: JSON.parse(JSON.stringify(session.battleData.player2))
          };

          // Включаем initialFleets в сохраняемый JSON
          session.battleData.initialFleets = session.initialFleets;

          // Сохраняем на диск вместе с turn
          fs.writeFileSync(
            path.join(GAMES_FOLDER, `${secret_id}.json`),
            JSON.stringify(session.battleData, null, 2)
          );
          log(`Оба игрока готовы. Бой начинается: ${secret_id}, ходит ${session.battleData.turn}`, 'info');

          // Рассылаем обоим игрокам сообщение о начале боя
          ['player1', 'player2'].forEach(roleKey => {
            send(session.sockets[roleKey], {
              type: 'battle',
              fleet: session.battleData[roleKey],
              battle_ready: true,
              turn: session.battleData.turn,
              shots: session.battleData.shots
            });
          });
        }
        return;

      case 'shoot': {
        const { x, y } = data;
        const session = sessions[secret_id];
        const bd = session.battleData;

        // Проверка очереди
        if (bd.turn !== ws.role) {
          return send(ws, { type: 'error', message: 'Сейчас не ваш ход' });
        }

        // Определяем противника
        const enemyRole = ws.role === 'player1' ? 'player2' : 'player1';
        const enemyFleet = bd[enemyRole];

        let isHit = false;
        let sunk = null;

        // Ищем попадание по каждому кораблю
        for (const [shipName, coords] of Object.entries(enemyFleet)) {
          const idx = coords.findIndex(p => p.x === x && p.y === y);
          if (idx !== -1) {
            isHit = true;
            // Сколько осталось до удаления
            const before = coords.length;
            coords.splice(idx, 1);
            const after = coords.length;
            log(`Попадание в ${shipName} у ${enemyRole}: до=${before}, после=${after}`, 'debug');

            if (after === 0) {
              log(`→ Корабль ${shipName} потоплен!`, 'info');
              sunk = {
                ship: shipName,
                coords: session.initialFleets[enemyRole][shipName]
              };
            }
            break;
          }
        }

        // Проверяем, всё ли корабли уничтожены
        const gameOver = Object.values(enemyFleet).every(coords => coords.length === 0);

        // Если промах — переключаем ход, иначе оставляем текущего
        if (!isHit && !gameOver) bd.turn = enemyRole;

        // Результат выстрела
        const result = {
          type: 'shot_result',
          x, y,
          isHit,
          by: ws.role,
          turn: bd.turn
        };

        if (gameOver) {
          result.gameOver = true;
          result.winner = ws.role;
        }

        if (sunk) result.sunk = sunk;

        // Добавляем запись в историю
        bd.shots = bd.shots || [];
        bd.shots.push({
          x,
          y,
          isHit,
          by: ws.role,
          sunk: sunk || null,
          gameOver: gameOver,
          winner: gameOver ? ws.role : null
        });

        const filePath = path.join(GAMES_FOLDER, `${secret_id}.json`);
        if (gameOver) {
          // удаляем игру
          try {
            fs.unlinkSync(filePath);
            log(`Игра ${secret_id} окончена, файл удалён`, 'info');
          } catch (e) {
            log(`Не удалось удалить файл ${filePath}: ${e.message}`, 'error');
          }
          delete sessions[secret_id];
        } else {
          // сохраняем обновления
          fs.writeFileSync(filePath, JSON.stringify(bd, null, 2));
          log(`Игра ${secret_id} обновлена после выстрела`, 'debug');
        }
        // Рассылаем результат обоим игрокам
        send(session.sockets.player1, result);
        send(session.sockets.player2, result);
        return;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Неизвестный тип' }));
        return;
    }

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
          fleet: session.battleData[roleKey],
          battle_ready: true,
          turn: session.battleData.turn,
          shots: session.battleData.shots
        }));
      });
    }
  });

  ws.on('close', () => {
    const { secret_id, role } = ws;
    if (!secret_id || !role) return;

    const session = sessions[secret_id];
    if (!session) return;

    log(`Отключён сокет: ${role} в ${secret_id}`, 'info');
    session.sockets[role] = null;

    const otherRole = role === 'player1' ? 'player2' : 'player1';
    const other = session.sockets[otherRole];

    // Уведомляем только соперника
    send(other, { type: 'pause' });
  });
});
