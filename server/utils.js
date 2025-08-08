// server/utils.js
export function send(ws, data) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Обёртка для последовательного выполнения async-операций в конкретной сессии.
export function queueSessionOp(secret_id, op, sessionQueues) {
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

export async function postProcessMessage(type, ws, session, secret_id) {
  // Привязываем сокет к сессии
  ws.secret_id = secret_id;
  session.sockets[ws.role] = ws;
  log(`Назначена роль ${ws.role} в сессии ${secret_id}`, 'info');

  // Отправляем роль клиенту
  send(ws, { type: 'role_assigned', role: ws.role });

  const p1 = session.sockets.player1;
  const p2 = session.sockets.player2;
  const both = Boolean(p1 && p2);

  if (type === 'connect') {
    if (both) {
      log(`Оба игрока подключены: ${secret_id}`, 'info');
      send(p1, { type: 'connected' });
      send(p2, { type: 'connected' });
    } else {
      send(ws, { type: 'waiting' });
    }

  } else {
    // reconnect
    if (both) {
      log(`Сессия восстановлена: ${secret_id}`, 'info');
      send(p1, { type: 'resume' });
      send(p2, { type: 'resume' });
    } else {
      send(ws, { type: 'waiting' });
    }
  }

  // === Универсальная проверка: если оба флота уже сохранены ===
  if (session.battleData?.player1 && session.battleData?.player2 && both) {
    log(`Рестарт боя для сессии ${secret_id}`, 'info');
    ['player1', 'player2'].forEach(roleKey => {
      send(session.sockets[roleKey], {
        type: 'battle',
        initialFleet: session.initialFleets[roleKey],
        battle_ready: true,
        turn: session.battleData.turn,
        shots: session.battleData.shots
      });
    });
  }
}

// Гарантированно возвращает объект сессии, создавая при необходимости.
export function getSession(secret_id, sessions) {
  if (!sessions[secret_id]) {
    sessions[secret_id] = {
      playerIds: { player1: null, player2: null },
      sockets: { player1: null, player2: null }
    };
  }
  return sessions[secret_id];
}

// Логирование
export function log(msg, level = 'info') {
  const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
  console.log(`[${ts}] [${level}] ${msg}`);
}

// Функция для запуска удаления мертвых сессий
export function startSessionGarbageCollector(GC_INTERVAL, SESSION_TTL, sessions, WebSocket) {
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
}

// Функция для запуска heartbeat-пинга
export function startWebSocketHeartbeat(wss, HEARTBEAT_INTERVAL) {
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);
}