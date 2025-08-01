// main.js

import { buildGrid, initFleetDraggables, enableGridDrop, populateFleetPanel, createGameContent } from './setup.js';
import { disableDoubleTapZoom } from './mobileEvents.js';
import { placeSunkShip, playExplosion } from './battle.js';
import { preloadAll  } from './preload.js';

disableDoubleTapZoom();

const connectBtn = document.getElementById('connectBtn');
const cancelBtn = document.getElementById('cancelBtn');
const modal = document.getElementById('modal');
const modalText = modal.querySelector('p');
const secretInput = document.getElementById('secretInput');
const connectionPanel = document.getElementById('connectionPanel');
const gameContainer = document.getElementById('gameContainer');

let socket = null;
let secret_id = null;
let role = null;
let selfDisconnect = false;

let myField = null;
let enemyField = null;
let currentTurn = null;

// предзагрузка изображений
let preloadedFire = [];
let preloadedMiss = [];
let preloadPromise = preloadAll()
  .then(({ fireFrames, missFrames }) => {
    console.log('Предзагружено всё! ', fireFrames.length, ' fire-кадров и ', missFrames.length, ' miss-кадров');
    preloadedFire = fireFrames;
    preloadedMiss = missFrames;
  })
  .catch(err => console.error('Ошибка при предзагрузке:', err));

document.body.classList.add('in-game');

// Генерим или читаем один раз уникальный playerId
let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = 'pid-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  localStorage.setItem('playerId', playerId);
}

// Открытие сокета и установка обработчиков
function openSocket(isReconnect = false) {
  // const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  // socket = new WebSocket(`${protocol}://${location.hostname}:3012`);

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}`);

  console.log('Открытие WebSocket…');

  socket.onopen = () => {
    // Включаем playerId в каждый connect/reconnect
    const base = { secret_id, playerId };
    const msg = isReconnect
      ? { ...base, type: 'reconnect', role }
      : { ...base, type: 'connect' };
    console.log('→ Отправка', msg);
    socket.send(JSON.stringify(msg));
  };

  socket.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    console.log('← Получено', data);
    handleServerMessage(data);
  };

  socket.onclose = (evt) => {
    console.warn('WebSocket закрылся', evt.code, evt.reason);
    if (!selfDisconnect) {
      showReloadModal(); // показываем только если это было не по инициативе пользователя
    }
    selfDisconnect = false; // сбрасываем на будущее
  };
}

// Показываем модалку с просьбой перезагрузить страницу
function showReloadModal() {
  modalText.textContent = 'Соединение потеряно. Пожалуйста, перезагрузите страницу.';
  // Переименуем кнопку в “Перезагрузить”
  cancelBtn.textContent = 'Перезагрузить';
  cancelBtn.classList.remove('hidden');
  // По клику делаем полную перезагрузку
  cancelBtn.onclick = () => window.location.reload();

  // Скрываем остальной UI
  modal.classList.remove('hidden');
  connectionPanel.classList.add('hidden');
  gameContainer.classList.add('hidden');
}


// Обработка сообщений сервера
function handleServerMessage(data) {
  console.log('data.type = \n', data.type);

  switch (data.type) {
    case 'role_assigned':
      role = data.role;
      sessionStorage.setItem('secret_id', secret_id);
      sessionStorage.setItem('role', role);
      console.log(`Назначена роль ${role}`);
      break;

    case 'waiting':
      showModal('Ожидаем второго игрока…');
      break;

    case 'connected':
      hideModal();
      showGame();
      console.log('Оба игрока подключены — старт игры');
      break;

    case 'pause':
      showModal('Соединение потеряно. Ожидаем соперника');
      break;

    case 'resume':
      hideModal();
      showGame();
      console.log('Оба игрока восстановили соединение');
      break;

    case 'id_taken':
      alert('Сессия уже занята двумя игроками');
      teardown();
      break;

    case 'battle':

      if (!data.battle_ready) {
        showModal('Ожидаем второго игрока…');
        return;
      }
      hideModal();

      // Ждём, пока кадры загрузятся и декодируются
      preloadPromise.then(() => {
        import('./battle.js').then(mod => {
          mod.startBattle(
            role,
            data.fleet,
            teardown,
            socket,
            secret_id,
            playerId,
            data.shots || []
          );
          // получаем DOM-поля
          myField = document.getElementById('myField');
          enemyField = document.getElementById('enemyField');
          currentTurn = data.turn;

          // ставим активности полей по очередности
          if (currentTurn === role) {
            // ваш ход — можно кликать по врагу
            enemyField.style.pointerEvents = 'auto';
            document.getElementById('game-title').textContent = 'Ваш ход'
          } else {
            // ждёшь хода соперника
            enemyField.style.pointerEvents = 'none';
            document.getElementById('game-title').textContent = 'Ожидание хода соперника'
          }
        });
      }).catch(err => {
        console.error('Ошибка предзагрузки кадров:', err);
        // на всякий случай всё равно запускаем бой, чтобы не вешать игру
        import('./battle.js').then(mod => {
          mod.startBattle(
            role,
            data.fleet,
            teardown,
            socket,
            secret_id,
            playerId,
            data.shots || []
          );
        });
      });

      break;

    case 'shot_result': {
      const { x, y, isHit, by, turn, sunk, gameOver, winner } = data;

      // Отметить попадание/промах в конкретной клетке
      const targetField = (by === role) ? enemyField : myField;
      const targetCell = targetField
        .querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
      if (targetCell) {

        if (isHit) {
          playExplosion(targetCell, 60, true, preloadedFire, preloadedMiss);
          setTimeout(() => {
            targetCell.classList.add('hit');
          }, 850);
        } else {
          playExplosion(targetCell, 60, false, preloadedFire, preloadedMiss);
          setTimeout(() => {
            targetCell.classList.add('miss');
          }, 450);
        }
      }
      // Если корабль утонул, обвести вокруг ВСЕ его клетки — и у стрелявшего, и у защищающегося
      if (sunk) {
        const deltas = [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1], [0, 1],
          [1, -1], [1, 0], [1, 1]
        ];

        // Выбираем поле, на котором рисуем «промахи вокруг»
        const ringField = (by === role) ? enemyField : myField;
        placeSunkShip(ringField, sunk.coords);

        sunk.coords.forEach(({ x: sx, y: sy }) => {
          deltas.forEach(([dx, dy]) => {
            const nx = sx + dx, ny = sy + dy;
            console.log(`поля для miss \n x=${nx} y=${ny}`);

            const cell = ringField.querySelector(`.cell[data-x="${nx}"][data-y="${ny}"]`);
            if (cell && !cell.classList.contains('hit')) {
              cell.classList.add('miss');
            }
          });
        });
      }

      // Обновляем очередь по серверному полю turn
      currentTurn = turn;
      if (!gameOver) {
        const myTurn = (currentTurn === role);
        enemyField.style.pointerEvents = myTurn ? 'auto' : 'none';
        document.getElementById('game-title').textContent = myTurn ? 'Ваш ход' : 'Ожидание хода соперника';
      }

      // Конец игры
      if (gameOver) {
        selfDisconnect = true;
        if (winner === role) {
          setTimeout(() => {
            // скрываем игровой контейнер
            gameContainer.classList.add('hidden');
            document.body.classList.remove('in-game');
            document.body.style.backgroundColor = 'rgb(249, 188, 112)';

            // создаём and вставляем winLayer + дети
            const winLayer = document.createElement('div');
            winLayer.className = 'win-layer';
            const gunLeft = Object.assign(document.createElement('div'), { className: 'gun-left' });
            const gunRight = Object.assign(document.createElement('div'), { className: 'gun-right' });
            const gold = Object.assign(document.createElement('div'), { className: 'gold' });
            const win = Object.assign(document.createElement('div'), { className: 'win-banner' });
            winLayer.append(gunLeft, gunRight, gold, win);
            document.body.appendChild(winLayer);

            // Создаём кнопку выхода
            const exitBtn = document.createElement('button');
            exitBtn.id = 'exitBtn';
            exitBtn.title = 'Вернуться к выбору комнаты';
            exitBtn.textContent = '↩';
            exitBtn.classList.add('exitBtn-end');
            document.body.append(exitBtn);

            const fireworks = new Fireworks.default(winLayer)

            // Обработка кнопки "Выход"
            exitBtn.onclick = () => {
              winLayer.remove();
              fireworks.stop();
              exitBtn.remove();
              teardown();
            };

            // анимации показа
            setTimeout(() => gunLeft.classList.add('show', 'slide-in-left'), 500);
            setTimeout(() => gunRight.classList.add('show', 'slide-in-right'), 1500);
            setTimeout(() => gold.classList.add('show'), 2500);
            setTimeout(() => {
              win.classList.add('show', 'slide-down');
              fireworks.start(); // запуск фейерверка
            }, 2000);

            setTimeout(() => { exitBtn.classList.add('show'); }, 3000);

          }, 850);

        } else {
          // скрываем игровой контейнер
          gameContainer.classList.add('hidden');
          document.body.classList.remove('in-game');
          document.body.style.backgroundColor = 'rgb(32, 60, 81)';

          // создаём and вставляем loseLayer + дети
          const loseLayer = document.createElement('div');
          loseLayer.className = 'lose-layer';
          const lose = Object.assign(document.createElement('div'), { className: 'lose-banner' });
          loseLayer.append(lose);
          document.body.appendChild(loseLayer);

          // Создаём кнопку выхода
          const exitBtn = document.createElement('button');
          exitBtn.id = 'exitBtn';
          exitBtn.title = 'Вернуться к выбору комнаты';
          exitBtn.textContent = '↩';
          exitBtn.classList.add('exitBtn-end');
          document.body.append(exitBtn);

          // Обработка кнопки "Выход"
          exitBtn.onclick = () => {
            loseLayer.remove();
            exitBtn.remove();
            teardown();
          };

          // анимации показа
          setTimeout(() => {
            lose.classList.add('show');
          }, 200);

          setTimeout(() => {
            exitBtn.classList.add('show');
          }, 1000);
        }
      }

      break;
    }

    case 'chat':
      const { from, text } = data;
      if (from !== role) {
        alert(text);
      } 
      break;

    case 'error':
      alert(data.message || 'Неизвестная ошибка');
      teardown();
      break;

    default:
      console.warn('Неизвестный тип сообщения', data);
  }
}

// UI-функции
function showModal(text) {
  modalText.textContent = text;
  cancelBtn.classList.remove('hidden');
  modal.classList.remove('hidden');
  connectionPanel.classList.add('hidden');
  gameContainer.classList.add('hidden');
  // document.body.classList.remove('in-game');
}

function hideModal() {
  modal.classList.add('hidden');
  cancelBtn.classList.add('hidden');
}

function showGame() {
  document.body.classList.add('in-game');
  const container = document.getElementById('gameContainer');
  if (container) container.innerHTML = '';
  createGameContent(socket, role, secret_id, playerId, showModal, teardown);

  hideModal();
  connectionPanel.classList.add('hidden');
  gameContainer.classList.remove('hidden');

  const grid = document.getElementById('playerGrid');
  const fleet = document.getElementById('fleetPanel');
  populateFleetPanel();
  buildGrid(grid, 13);
  initFleetDraggables(fleet);
  enableGridDrop(grid);

  const exitBtn = document.getElementById('exitBtn');
  if (exitBtn && exitBtn.classList.contains('hidden')) {
    exitBtn.classList.remove('hidden');
  }
}

// Очистка всего состояния
function teardown() {
  selfDisconnect = true; // помечаем закрытие как намеренное
  sessionStorage.clear();
  secretInput.value = '';
  role = null;
  secret_id = null;
  if (socket) socket.close();
  socket = null;
  hideModal();
  connectionPanel.classList.remove('hidden');
  gameContainer.classList.add('hidden');
  document.body.classList.add('in-game');
}

// Отмена из модалки
cancelBtn.onclick = () => {
  console.log('Пользователь нажал отмену');
  teardown();
};

// Автоматическая попытка восстановления
window.addEventListener('load', () => {
  const savedID = sessionStorage.getItem('secret_id');
  const savedRole = sessionStorage.getItem('role');
  if (savedID && savedRole) {
    secret_id = savedID;
    role = savedRole;
    console.log(`Авто-реконнект в ${savedID} как ${savedRole}`);
    openSocket(true);
  }
});

// Обработка кнопки "Подключение"
connectBtn.onclick = () => {
  secret_id = secretInput.value.trim();
  if (!secret_id || secret_id.length > 8) {
    return alert('Secret ID должен быть не длиннее 8 символов');
  }
  openSocket(false);
};
