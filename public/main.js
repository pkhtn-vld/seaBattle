// main.js

import { buildGrid, initFleetDraggables, enableGridDrop, rotateFleetShips, resetGame, randomizeFleetPlacement } from './setup.js';

const connectBtn = document.getElementById('connectBtn');
const cancelBtn = document.getElementById('cancelBtn');
const modal = document.getElementById('modal');
const modalText = modal.querySelector('p');
const secretInput = document.getElementById('secretInput');
const connectionPanel = document.getElementById('connectionPanel');
const gameContainer = document.getElementById('gameContainer');
const rotateBtn = document.getElementById('rotateBtn');
const readyBtn = document.getElementById('readyBtn');
const randomBtn = document.getElementById('randomBtn');

let socket = null;
let secret_id = null;
let role = null;

// Открытие сокета и установка обработчиков
function openSocket(isReconnect = false) {
  socket = new WebSocket('ws://192.168.0.208:3012');
  console.log('Открытие WebSocket…');

  socket.onopen = () => {
    const msg = isReconnect
      ? { type: 'reconnect', secret_id, role }
      : { type: 'connect', secret_id };
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
    // Показываем модалку именно возвращающемуся (восстановившемуся) игроку
    showReloadModal();
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
  document.body.classList.add('setup-mode');
  hideModal();
  connectionPanel.classList.add('hidden');
  gameContainer.classList.remove('hidden');

  const grid = document.getElementById('playerGrid');
  const fleet = document.getElementById('fleetPanel');
  buildGrid(grid);
  initFleetDraggables(fleet);
  enableGridDrop(grid);
}

// Очистка всего состояния
function teardown() {
  sessionStorage.clear();
  secretInput.value = '';
  role = null;
  secret_id = null;
  if (socket) socket.close();
  socket = null;
  hideModal();
  connectionPanel.classList.remove('hidden');
  gameContainer.classList.add('hidden');
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

// Обработка кнопки "Повернуть"
rotateBtn.onclick = () => {
  rotateFleetShips();
};

// Обработка кнопки "Сброс"
document.getElementById('resetBtn').addEventListener('click', resetGame);

// Обработка кнопки "Случайное расположение"
randomBtn.onclick = () => {
  const fleetPanel = document.getElementById('fleetPanel');
  // если все корабли уже расставлены — сначала сброс
  if (fleetPanel.querySelectorAll('.ship').length === 0) {
    resetGame();
  }
  randomizeFleetPlacement();
};

document.addEventListener('touchstart', function (e) {
  if (e.touches.length > 1) {
    e.preventDefault(); // блокирует pinch-to-zoom
  }
}, { passive: false });

let tapTimeout = null;

document.addEventListener('touchstart', function (e) {
  if (tapTimeout !== null) {
    clearTimeout(tapTimeout);     // отменяем предыдущий таймер
    tapTimeout = null;
    e.preventDefault();           // отменяем второй тап
  } else {
    tapTimeout = setTimeout(() => {
      tapTimeout = null;          // сбрасываем через 500 мс
    }, 500);
  }
}, { passive: false });

