// setup.js — логика этапа подготовки (setup)

let currentDraggedData = null;
let dragGhost = null;

// pointer‑down: начинаем «таскать»
function onPointerDown(e) {
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
  const shipEl = e.currentTarget;
  shipEl.releasePointerCapture(e.pointerId);

  // установка
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const cell = under && under.classList.contains('cell') && under;
  if (cell && currentDraggedData) {
    const x = +cell.dataset.x;
    const y = +cell.dataset.y - 2;
    if (y >= 0) {
      placeShipOnGrid(
        currentDraggedData.length,
        x, y,
        currentDraggedData.id,
        currentDraggedData.orientation
      );
    }
  }

  // снятие слушателей
  shipEl.removeEventListener('pointermove', onPointerMove);
  shipEl.removeEventListener('pointerup', onPointerUp);
  shipEl.removeEventListener('pointercancel', onPointerUp);

  // чистка
  clearPreview();
  if (dragGhost) document.body.removeChild(dragGhost);
  dragGhost = null;
  currentDraggedData = null;
}

// helper: позиционирование ghost рядом с пальцем
const createGhostMover = () => {
  let orientation = null;
  let length = null;

  return function moveGhost(cx, cy, newOrientation, newLength) {
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
    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < 10; x++) {
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
export function populateFleetPanel() {
  const fleetPanel = document.getElementById("fleetPanel");
  if (fleetPanel) {
    fleetPanel.innerHTML = '';
    [4, 3, 3, 2, 2, 2, 1, 1, 1, 1].forEach(len => {
      const ship = document.createElement("div");
      ship.className = "ship";
      ship.dataset.length = len;
      ship.dataset.orientation = "horizontal";
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

// Размещает корабль и помечает ячейки
export function placeShipOnGrid(length, x, y, shipId, orientation) {
  const cells = [];
  for (let i = 0; i < length; i++) {
    const tx = orientation === 'horizontal' ? x + i : x;
    const ty = orientation === 'vertical' ? y - i : y; // снизу вверх

    const selector = `.cell[data-x="${tx}"][data-y="${ty}"]`;
    const cell = document.querySelector(selector);
    if (!cell || !cellIsFreeWithBuffer(cell)) return false;
    cells.push(cell);
  }

  cells.forEach(cell => {
    cell.classList.add('occupied');
    cell.dataset.shipId = shipId;
  });

  // Удаляем исходный элемент корабля из панели
  const shipEl = document.querySelector(`.ship[data-id="${shipId}"]`);
  if (shipEl) shipEl.remove();
  return true;
}

// Случайное размещение оставшихся кораблей (с учётом буфера)
export function randomizeFleetPlacement() {
  const grid = document.getElementById('playerGrid');
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
      const x = Math.floor(Math.random() * 10);
      // для вертикали y — нижняя клетка
      const y = orientation === 'horizontal'
        ? Math.floor(Math.random() * 10)
        : Math.floor(Math.random() * 10) + (length - 1);
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
      if (nx < 0 || nx >= 10 || ny < 0 || ny >= 10) continue;
      const neighbor = document.querySelector(
        `.cell[data-x="${nx}"][data-y="${ny}"]`
      );
      if (neighbor && neighbor.classList.contains('occupied')) return false;
    }
  }
  return true;
}

// Поворот флота
export function rotateFleetShips() {
  const ships = document.querySelectorAll('#fleetPanel .ship');

  ships.forEach(ship => {
    const length = +ship.dataset.length;                     // число клеток
    const isVertical = ship.dataset.orientation === 'vertical';

    if (isVertical) {
      ship.dataset.orientation = 'horizontal';
      ship.style.width = `${length * 30}px`; // длина по X
      ship.style.height = `30px`; // толщина

      ship.classList.remove('vertical');
      ship.classList.add('horizontal');
    } else {
      ship.dataset.orientation = 'vertical';
      ship.style.width = `30px`; // толщина
      ship.style.height = `${length * 30}px`; // длина по Y

      ship.classList.remove('horizontal');
      ship.classList.add('vertical');
    }
  });
}

// Обработчка кнопки сброса
export function resetGame() {
  // 1. Очищаем все ячейки
  document.querySelectorAll('.cell').forEach(cell => {
    cell.classList.remove('occupied', 'preview-ok', 'preview-bad');
    delete cell.dataset.shipId;
  });

  // 2. Сбрасываем корабли
  const fleetPanel = document.getElementById('fleetPanel');
  fleetPanel.innerHTML = ''; // убираем старые корабли
  shipCounter = 1;

  const shipConfigs = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]; // длины кораблей
  shipConfigs.forEach(length => {
    const ship = document.createElement('div');
    ship.className = 'ship';
    ship.dataset.length = length;
    ship.dataset.orientation = 'horizontal';
    ship.style.width = `${length * 30}px`;
    ship.style.height = '26px';
    fleetPanel.appendChild(ship);
  });

  initFleetDraggables(fleetPanel);
}

export function collectFleetData() {
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
