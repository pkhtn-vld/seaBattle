// main.js

import { buildGrid, initFleetDraggables, enableGridDrop, rotateFleetShips, resetGame, randomizeFleetPlacement, populateFleetPanel, collectFleetData } from './setup.js';

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
let selfDisconnect = false;

// Генерим или читаем один раз уникальный playerId
let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = 'pid-' + Date.now() + '-' + Math.floor(Math.random()*1e6);
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
      import('./battle.js').then(mod => mod.startBattle(role, data.fleet, teardown));
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
  const container = document.getElementById('gameContainer');
  if (container) container.innerHTML = '';

  document.body.classList.add('setup-mode');
  hideModal();
  connectionPanel.classList.add('hidden');
  gameContainer.classList.remove('hidden');

  const grid = document.getElementById('playerGrid');
  const fleet = document.getElementById('fleetPanel');
  populateFleetPanel();
  buildGrid(grid, 12);
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

// Обработка кнопки "Готов"
readyBtn.onclick = () => {

  // проверяем что все корабли установлены
  const fleetPanel = document.getElementById('fleetPanel');
  if (fleetPanel.children.length > 0) {
    alert('Пожалуйста, расставьте все корабли на поле');
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    const fleet = collectFleetData(); // собираем корабли
    socket.send(JSON.stringify({
      type: 'battle_start',
      secret_id,
      role,
      playerId,
      fleet
    }));
    console.log('→ Отправлено событие battle_start');
    showModal('Ожидаем второго игрока…');
  }
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

