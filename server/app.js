// app.js

// Зависимости
import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { send } from './utils.js';

// Настройки
const PORT = 3012;
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

    const { type, secret_id, role: clientRole } = data;
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

    switch (type) {

      case 'connect':
        if (!session.sockets.player1) {
          ws.role = 'player1';
        } else if (!session.sockets.player2) {
          ws.role = 'player2';
        } else {
          log(`Сессия ${secret_id} заполнена`, 'warn');
          ws.send(JSON.stringify({ type: 'id_taken' }));
          return;
        }

        break;

      case 'reconnect':
        if (!['player1', 'player2'].includes(clientRole)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Некорректная роль' }));
          return;
        }
        if (session.sockets[clientRole]) {
          ws.send(JSON.stringify({ type: 'error', message: 'Роль уже занята' }));
          return;
        }
        ws.role = clientRole;
        break;

      case 'battle_start':
        log(`battle_start от ${ws.role} в сессии ${secret_id}`, 'info');

        // Инициализируем battleData, если её нет
        session.battleData = session.battleData || {};
        session.battleData[ws.role] = data.fleet; // сохраняем данные флота

        // Сохраняем на диск
        fs.writeFileSync(
          path.join(GAMES_FOLDER, `${secret_id}.json`),
          JSON.stringify(session.battleData, null, 2)
        );
        log(`Данные игрока ${ws.role} сохранены`, 'debug');

        // Если оба игрока прислали данные — начинаем бой
        if (session.battleData.player1 && session.battleData.player2) {
          log(`Оба игрока готовы. Бой начинается: ${secret_id}`, 'info');
          ['player1', 'player2'].forEach(roleKey => {
            send(session.sockets[roleKey], {
              type: 'battle',
              fleet: session.battleData[roleKey],
              battle_ready: true
            });
          });
        }
        return;

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
          battle_ready: true
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
