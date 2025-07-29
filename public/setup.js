// setup.js — логика этапа подготовки (setup)

let currentDraggedData = null;
let dragGhost = null;
let lastShip = null;

function disablePlacedPointerEvents() {
  const grid = document.getElementById('playerGrid');
  grid.classList.add('drag-mode');
  document.querySelectorAll('.placed-ship').forEach(el => {
    el.style.pointerEvents = 'none';
  });
}

function enablePlacedPointerEvents() {
  const grid = document.getElementById('playerGrid');
  grid.classList.remove('drag-mode');
  document.querySelectorAll('.placed-ship').forEach(el => {
    el.style.pointerEvents = 'auto';
  });
}

// pointer‑down: начинаем «таскать»
function onPointerDown(e) {
  disablePlacedPointerEvents();
  const shipEl = e.currentTarget;
  e.preventDefault();
  shipEl.setPointerCapture(e.pointerId);

  // читаем параметры корабля
  const length = +shipEl.dataset.length;
  const orientation = shipEl.dataset.orientation;
  const id = `ship_${shipCounter++}`;
  shipEl.dataset.id = id;
  currentDraggedData = { length, id, orientation };

  // создаём ghost‑призрак
  dragGhost = shipEl.cloneNode(true);
  dragGhost.classList.add('dragging');
  dragGhost.style.position = 'fixed';
  dragGhost.style.opacity = '0.2';
  dragGhost.style.pointerEvents = 'none';
  document.body.appendChild(dragGhost);

  // сразу позиционируем
  moveGhost(e.clientX, e.clientY, orientation, length);

  // слушаем движение и отпускание
  shipEl.addEventListener('pointermove', onPointerMove);
  shipEl.addEventListener('pointerup', onPointerUp);
  shipEl.addEventListener('pointercancel', onPointerUp);
}

// pointer‑move: двигаем ghost и рисуем превью
function onPointerMove(e) {
  disablePlacedPointerEvents();
  e.preventDefault();
  moveGhost(e.clientX, e.clientY);

  // превью-логика: почти как в dragover,
  // но с cell под пальцем:
  clearPreview();
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const cell = under && under.classList.contains('cell') && under;
  if (!cell || !currentDraggedData) return;

  // стартовая точка на одну клетку выше
  const x0 = +cell.dataset.x;
  const y0 = +cell.dataset.y - 2;
  if (y0 < 0) return;

  const { length, orientation } = currentDraggedData;
  const previewCells = [];
  let fits = true;
  for (let i = 0; i < length; i++) {
    const tx = orientation === 'horizontal' ? x0 + i : x0;
    const ty = orientation === 'vertical' ? y0 - i : y0;
    const c = document.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
    if (!c || !cellIsFreeWithBuffer(c)) fits = false;
    previewCells.push(c);
  }
  previewCells.forEach(c => c && c.classList.add(fits ? 'preview-ok' : 'preview-bad'));
}

// pointer‑up/cancel: ставим корабль и убираем всё
function onPointerUp(e) {

  // установка
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const cell = under && under.classList.contains('cell') && under;
  let placedSuccessfully = false;
  if (cell && currentDraggedData) {
    const x = +cell.dataset.x;
    const y = +cell.dataset.y - 2;
    if (y >= 0) {
      placedSuccessfully = placeShipOnGrid(
        currentDraggedData.length,
        x, y,
        currentDraggedData.id,
        currentDraggedData.orientation
      );
    }
  }

  // Если это перемещение и размещение успешно — удаляем старый элемент
  if (currentDraggedData?.isRelocating) {
    if (placedSuccessfully) {
      currentDraggedData.oldEl.remove();
    } else {
      // Восстанавливаем старое положение, если не удалось разместить
      currentDraggedData.oldEl.style.display = '';
      currentDraggedData.oldCells.forEach(c => {
        c.classList.add('occupied');
        c.dataset.shipId = currentDraggedData.id;
        
        lastShip.style.opacity = '1';
        lastShip.style.pointerEvents = 'all';

      });
    }
  }

  // снятие слушателей
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);

  // чистка
  clearPreview();
  if (dragGhost) document.body.removeChild(dragGhost);
  dragGhost = null;
  currentDraggedData = null;
  
  enablePlacedPointerEvents();
}

// helper: позиционирование ghost рядом с пальцем
const createGhostMover = () => {
  let orientation = null;
  let length = null;

  return function moveGhost(cx, cy, newOrientation, newLength) {
    if (!dragGhost) return;
    if (newOrientation) orientation = newOrientation;
    if (newLength) length = newLength;

    const offsetX = 15;
    const offsetY = orientation === 'vertical' ? (length * -30 - 50) : -75;

    dragGhost.style.left = `${cx - offsetX}px`;
    dragGhost.style.top = `${cy + offsetY}px`;
  };
};

const moveGhost = createGhostMover();

// Строит сетку 10×10 в контейнере
export function buildGrid(container, yCount) {
  if (container) {
    container.innerHTML = '';
    for (let y = 1; y < yCount; y++) {
      for (let x = 1; x < 11; x++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.x = x;
        cell.dataset.y = y;
        container.appendChild(cell);
      }
    }
  }
}

// Инициализация перетаскивания кораблей
let shipCounter = 1;
export function initFleetDraggables(fleetPanel) {
  if (!fleetPanel) return;

  const ships = fleetPanel.querySelectorAll('.ship');
  if (ships) {
    ships.forEach(ship => {
      // вместо HTML5 drag — pointer‑based
      ship.style.touchAction = 'none';    // важен для pointer’ов
      ship.addEventListener('pointerdown', onPointerDown);
    });
  }
}

// Заполняем html кораблями
export function populateFleetPanel(orientation) {
  const fleetPanel = document.getElementById("fleetPanel");
  if (fleetPanel) {
    fleetPanel.innerHTML = '';
    [4, 3, 3, 2, 2, 2, 1, 1, 1, 1].forEach(len => {
      const ship = document.createElement("div");
      ship.className = "ship";
      ship.dataset.length = len;
      ship.dataset.orientation = orientation ? orientation : 'horizontal';

      if (ship?.dataset?.orientation) {
        const isVertical = ship.dataset.orientation === 'vertical';
        ship.classList.toggle('vertical', isVertical);
        ship.classList.toggle('horizontal', !isVertical);
      }

      fleetPanel.appendChild(ship);
    });
  }
}

// Обработка превью и drop на гриде
export function enableGridDrop(gridEl) {
  if (!gridEl) return;

  gridEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!currentDraggedData) return;

    const { length, orientation } = currentDraggedData;
    const cell = e.target.closest('.cell');
    if (!cell) return;

    clearPreview();
    const x = +cell.dataset.x;
    const y = +cell.dataset.y - 2;  // начало превью на одну клетку выше
    if (y < 0) { clearPreview(); return; }
    const previewCells = [];
    let fits = true;

    for (let i = 0; i < length; i++) {
      // если horizontal — смещаем по X, если vertical — по Y
      const tx = orientation === 'horizontal' ? x + i : x;
      const ty = orientation === 'vertical' ? y - i : y; // снизу вверх

      const c = document.querySelector(
        `.cell[data-x="${tx}"][data-y="${ty}"]`
      );
      if (!c || !cellIsFreeWithBuffer(c)) fits = false;
      previewCells.push(c);
    }

    previewCells.forEach(c =>
      c && c.classList.add(fits ? 'preview-ok' : 'preview-bad')
    );
  });

  gridEl.addEventListener('dragleave', clearPreview);

  gridEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!currentDraggedData) return;

    const { length, id, orientation } = currentDraggedData;
    const cell = e.target.closest('.cell');
    clearPreview();
    if (!cell) return;

    const x = +cell.dataset.x;
    const y = +cell.dataset.y - 2;  // реальное размещение на одну клетку выше
    if (y < 0) { clearPreview(); return; }
    placeShipOnGrid(length, x, y, id, orientation);

    currentDraggedData = null;
  });
}

// Убираем превью-классы
function clearPreview() {
  document.querySelectorAll('.cell.preview-ok, .cell.preview-bad')
    .forEach(c => c.classList.remove('preview-ok', 'preview-bad'));
}

function placeShipOnGrid(length, x, y, shipId, orientation) {
  const cells = [];
  for (let i = 0; i < length; i++) {
    const tx = orientation === 'horizontal' ? x + i : x;
    const ty = orientation === 'vertical' ? y - i : y;
    const c = document.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
    if (!c || !cellIsFreeWithBuffer(c)) return false;
    cells.push(c);
  }

  // 2) отмечаем сами клетки (для правила «буфер»)
  cells.forEach(c => {
    c.classList.add('occupied');
    c.dataset.shipId = shipId;
  });

  // решаем, по какой клетке якорить спрайт:
  //    — горизонтальные: по левой (cells[0])
  //    — вертикальные:   по _верхней_ (последний элемент массива)
  const anchorCell = orientation === 'vertical'
    ? cells[cells.length - 1]
    : cells[0];

  // создаём единый <div class="placed-ship">
  const shipEl = document.createElement('div');
  shipEl.classList.add('placed-ship');
  shipEl.dataset.length = length;
  shipEl.dataset.orientation = orientation;
  shipEl.dataset.shipId = shipId;

  // вычисляем оффсет внутри grid’а
  const gridRect = document.getElementById('playerGrid').getBoundingClientRect();
  const rect = anchorCell.getBoundingClientRect();
  const offsetX = rect.left - gridRect.left;
  const offsetY = rect.top - gridRect.top;

  shipEl.style.left = offsetX + 'px';
  shipEl.style.top = offsetY + 'px';

  // рисуем спрайт и удаляем «сырой» элемент из панели
  document.getElementById('playerGrid').appendChild(shipEl);
  const orig = document.querySelector(`.ship[data-id="${shipId}"]`);
  if (orig) orig.remove();

  // Инициализируем перетаскивание для этого размещенного корабля
  initPlacedShipDragging(shipEl);

  return true;
}

// Инициализация перетаскивания для размещенных кораблей
function initPlacedShipDragging(shipEl) {
  shipEl.style.touchAction = 'none';
  shipEl.addEventListener('pointerdown', onPlacedPointerDown);
}

// pointer-down для размещенных кораблей (аналог onPointerDown, но с очисткой и восстановлением)
function onPlacedPointerDown(e) {
  const shipEl = e.currentTarget;
  e.preventDefault();
  shipEl.setPointerCapture(e.pointerId);

  // Читаем параметры
  const length = +shipEl.dataset.length;
  const orientation = shipEl.dataset.orientation;
  const id = shipEl.dataset.shipId;

  // Сохраняем старые клетки для возможного восстановления
  const oldCells = Array.from(document.querySelectorAll(`.cell[data-ship-id="${id}"]`));

  // Временно очищаем клетки (чтобы проверка свободности работала корректно во время drag)
  oldCells.forEach(c => {
    c.classList.remove('occupied');
    delete c.dataset.shipId;
  });

  // Временно скрываем старый элемент
  shipEl.style.opacity = '0';
  shipEl.style.pointerEvents = 'none';

  lastShip = shipEl;

  // Устанавливаем данные для drag (с флагом перемещения)
  currentDraggedData = { length, id, orientation, isRelocating: true, oldEl: shipEl, oldCells };

  // Создаём ghost
  dragGhost = shipEl.cloneNode(true);
  dragGhost.classList.add('dragging', 'ship'); // Добавляем 'ship' для стилей, если нужно
  dragGhost.style.position = 'fixed';
  dragGhost.style.opacity = '0.2';
  dragGhost.style.pointerEvents = 'none';
  document.body.appendChild(dragGhost);

  dragGhost.classList.add('preview-ghost');

  // Позиционируем ghost
  moveGhost(e.clientX, e.clientY, orientation, length);

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
}
// Случайное размещение оставшихся кораблей (с учётом буфера)
function randomizeFleetPlacement() {
  const fleetPanel = document.getElementById('fleetPanel');
  const ships = Array.from(fleetPanel.querySelectorAll('.ship'));
  ships.forEach(shipEl => {
    const length = +shipEl.dataset.length;
    // Случайная ориентация
    const orientation = Math.random() < 0.5 ? 'horizontal' : 'vertical';
    shipEl.dataset.orientation = orientation;
    // Обновляем стили
    if (orientation === 'horizontal') {
      shipEl.style.width = `${length * 30}px`;
      shipEl.style.height = `26px`;
      shipEl.classList.add('horizontal');
      shipEl.classList.remove('vertical');
    } else {
      shipEl.style.width = `30px`;
      shipEl.style.height = `${length * 30}px`;
      shipEl.classList.add('vertical');
      shipEl.classList.remove('horizontal');
    }
    // Пробуем разместить
    let placed = false;
    while (!placed) {
      const x = Math.floor(Math.random() * 10) + 1;
      const y = Math.floor(Math.random() * (11 - length)) + 1;
      // генерим id, если ещё нет
      const id = shipEl.dataset.id || `ship_${shipCounter++}`;
      shipEl.dataset.id = id;
      if (placeShipOnGrid(length, x, y, id, orientation)) {
        placed = true;
      }
    }
  });
}

// Правило буфера между кораблями в одну клетку
function cellIsFreeWithBuffer(cell) {
  if (!cell || cell.classList.contains('occupied')) return false;
  const x = +cell.dataset.x;
  const y = +cell.dataset.y;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || nx > 10 || ny < 1 || ny > 10) continue;
      const neighbor = document.querySelector(
        `.cell[data-x="${nx}"][data-y="${ny}"]`
      );
      if (neighbor && neighbor.classList.contains('occupied')) return false;
    }
  }
  return true;
}

// Поворот флота
function rotateFleetShips() {
  const ships = document.querySelectorAll('#fleetPanel .ship');

  ships.forEach(ship => {
    // Меняем ориентацию
    const newOrientation = ship.dataset.orientation === 'vertical' ? 'horizontal' : 'vertical';
    ship.dataset.orientation = newOrientation;

    // Меняем классы
    ship.classList.toggle('horizontal');
    ship.classList.toggle('vertical');
  });
}

// Обработчка кнопки сброса
function resetGame() {

  // Удаляем все визуальные корабли
  const grid = document.getElementById('playerGrid');
  const placedShips = grid.querySelectorAll('.placed-ship');
  placedShips.forEach(ship => ship.remove());

  // Очищаем все ячейки
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('occupied', 'preview-ok', 'preview-bad');
    delete cell.dataset.shipId;
  });

  // Сбрасываем корабли
  const fleetPanel = document.getElementById('fleetPanel');
  const firstChild = fleetPanel.firstElementChild;
  const orientation = firstChild ? firstChild.getAttribute('data-orientation') : null;
  fleetPanel.innerHTML = '';
  shipCounter = 1;

  populateFleetPanel(orientation);

  initFleetDraggables(fleetPanel);
}

function collectFleetData() {
  const grid = document.getElementById('playerGrid');
  const cells = grid.querySelectorAll('.cell[data-ship-id]');
  const fleet = {};

  cells.forEach(cell => {
    const shipId = cell.dataset.shipId;
    const x = parseInt(cell.dataset.x, 10);
    const y = parseInt(cell.dataset.y, 10);

    if (!fleet[shipId]) fleet[shipId] = [];
    fleet[shipId].push({ x, y });
  });

  return fleet;
}

export function createGameContent(socket, role, secret_id, playerId, showModal, teardown) {
  const gameContainer = document.getElementById('gameContainer');
  if (!gameContainer) return;

  // Очистим контейнер (на всякий случай)
  gameContainer.innerHTML = '';

  // Заголовок
  const title = document.createElement('h2');
  title.textContent = 'Разместите свои корабли';
  gameContainer.appendChild(title);

  // Центральная область
  const middle = document.createElement('div');
  middle.className = 'container-middle';

  const playerGrid = document.createElement('div');
  playerGrid.id = 'playerGrid';
  playerGrid.className = 'grid';

  const fleetPanel = document.createElement('div');
  fleetPanel.id = 'fleetPanel';

  middle.appendChild(playerGrid);
  middle.appendChild(fleetPanel);
  gameContainer.appendChild(middle);

  // Кнопки управления
  const controls = document.createElement('div');
  controls.id = 'controls';

  const rotateBtn = document.createElement('button');
  rotateBtn.id = 'rotateBtn';
  rotateBtn.textContent = 'Повернуть';

  const readyBtn = document.createElement('button');
  readyBtn.id = 'readyBtn';
  readyBtn.textContent = 'Готов';

  const resetBtn = document.createElement('button');
  resetBtn.id = 'resetBtn';
  resetBtn.textContent = 'Сброс';

  const randomBtn = document.createElement('button');
  randomBtn.id = 'randomBtn';
  randomBtn.textContent = '🎲';

  controls.appendChild(rotateBtn);
  controls.appendChild(readyBtn);
  controls.appendChild(resetBtn);
  controls.appendChild(randomBtn);

  // Создаём кнопку выхода
  const exitBtn = document.createElement('button');
  exitBtn.id = 'exitBtn';
  exitBtn.title = 'Вернуться к выбору комнаты';
  exitBtn.textContent = '↩';
  exitBtn.classList.add('setup');
  controls.appendChild(exitBtn);

  // Обработка кнопки "Выход"
  exitBtn.onclick = () => {
    teardown();
  };

  gameContainer.appendChild(controls);

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
}
