// setup.js — логика этапа подготовки (setup)

let currentDraggedData = null;

// Строит сетку 10×10 в контейнере
export function buildGrid(container) {
  container.innerHTML = '';
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      container.appendChild(cell);
    }
  }
}

// Инициализация перетаскивания кораблей
let shipCounter = 1;
export function initFleetDraggables(fleetPanel) {
  const ships = fleetPanel.querySelectorAll('.ship');
  ships.forEach(ship => {
    ship.draggable = true;

    ship.addEventListener('dragstart', (e) => {
      handleShipDragStart(e);
      ship.classList.add('dragging');
    });

    ship.addEventListener('dragend', () => {
      ship.classList.remove('dragging');
    });
  });
}

function handleShipDragStart(e) {
  const shipEl = e.target;
  const length = parseInt(shipEl.dataset.length, 10);
  if (!length) {
    console.warn('Нет data-length у корабля:', shipEl);
    return;
  }

  // Считываем ориентацию из классов
  const orientation = shipEl.classList.contains('vertical')
    ? 'vertical'
    : 'horizontal';

  const id = `ship_${shipCounter++}`;
  shipEl.dataset.id = id;

  currentDraggedData = { length, id, orientation };

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  console.log('dragstart:', currentDraggedData);
}

// Обработка превью и drop на гриде
export function enableGridDrop(gridEl) {
  gridEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!currentDraggedData) return;

    const { length, orientation } = currentDraggedData;
    const cell = e.target.closest('.cell');
    if (!cell) return;

    clearPreview();
    const x = +cell.dataset.x;
    const y = +cell.dataset.y;
    const previewCells = [];
    let fits = true;

    for (let i = 0; i < length; i++) {
      // если horizontal — смещаем по X, если vertical — по Y
      const tx = orientation === 'horizontal' ? x + i : x;
      const ty = orientation === 'vertical'   ? y - i : y; // снизу вверх

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
    const y = +cell.dataset.y;
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
    const ty = orientation === 'vertical'   ? y - i : y; // снизу вверх

    const selector = `.cell[data-x="${tx}"][data-y="${ty}"]`;
    const cell = document.querySelector(selector);
    if (!cell || !cellIsFreeWithBuffer(cell)) return;
    cells.push(cell);
  }

  cells.forEach(cell => {
    cell.classList.add('occupied');
    cell.dataset.shipId = shipId;
  });

  // Удаляем исходный элемент корабля из панели
  const shipEl = document.querySelector(`.ship[data-id="${shipId}"]`);
  if (shipEl) shipEl.remove();
}

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
      ship.style.width  = `${length * 30}px`; // длина по X
      ship.style.height = `30px`; // толщина
      
      ship.classList.remove('vertical');
      ship.classList.add('horizontal');
    } else {
      ship.dataset.orientation = 'vertical';
      ship.style.width  = `30px`; // толщина
      ship.style.height = `${length * 30}px`; // длина по Y

      ship.classList.remove('horizontal');
      ship.classList.add('vertical');
    }
  });
}

// обработчка кнопки сброса
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
    ship.style.height = '30px';
    fleetPanel.appendChild(ship);
  });

  initFleetDraggables(fleetPanel);
}
