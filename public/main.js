// main.js

import { buildGrid, initFleetDraggables, enableGridDrop, populateFleetPanel, createGameContent } from './setup.js';
import { disableDoubleTapZoom } from './mobileEvents.js';

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

// Генерим или читаем один раз уникальный playerId
let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = 'pid-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  localStorage.setItem('playerId', playerId);
}

// Открытие сокета и установка обработчиков
function openSocket(isReconnect = false) {
  socket = new WebSocket('ws://192.168.0.208:3012');
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

  document.body.classList.remove('setup-mode');
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
      console.log('case battle →', data);
      if (!data.battle_ready) {
        showModal('Ожидаем второго игрока…');
        return;
      }
      hideModal();
      import('./battle.js').then(mod => {
        mod.startBattle(role, data.fleet, teardown, socket, secret_id, playerId, data.shots || []);

        // получаем DOM-поля
        myField = document.getElementById('myField');
        enemyField = document.getElementById('enemyField');
        currentTurn = data.turn;

        // ставим активности полей по очередности
        if (currentTurn === role) {
          // ваш ход — можно кликать по врагу
          enemyField.style.pointerEvents = 'auto';
          document.getElementById('game-title').textContent = 'Ваш ход 🎮'
        } else {
          // ждёшь хода соперника
          enemyField.style.pointerEvents = 'none';
          document.getElementById('game-title').textContent = 'Ожидание хода соперника ⏳'
        }
      });
      break;

    case 'shot_result': {
      const { x, y, isHit, by, turn, sunk, gameOver, winner } = data;

      // Отметить попадание/промах в конкретной клетке
      const targetField = (by === role) ? enemyField : myField;
      const targetCell = targetField
        .querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
      if (targetCell) {
        targetCell.classList.add(isHit ? 'hit' : 'miss');
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
        document.getElementById('game-title').textContent = myTurn ? 'Ваш ход 🎮' : 'Ожидание хода соперника ⏳';
      }

      // Конец игры
      if (gameOver) {
        if (winner === role) {
          alert('Поздравляем 🎉🎉, Вы победили 🏆');
        } else {
          alert('К сожалению, вы проиграли ☠️');
        }
        teardown();
      }
      break;
    }

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

  document.body.classList.remove('setup-mode');
}

function hideModal() {
  modal.classList.add('hidden');
  cancelBtn.classList.add('hidden');
}

function showGame() {
  const container = document.getElementById('gameContainer');
  if (container) container.innerHTML = '';
  createGameContent(socket, role, secret_id, playerId, showModal, teardown);

  document.body.classList.add('setup-mode');
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
  document.body.classList.remove('setup-mode');
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
