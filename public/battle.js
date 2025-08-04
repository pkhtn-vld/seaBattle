// public/battle.js
import { buildGrid } from './setup.js';

export function startBattle(role, fleet, teardown, socket, secret_id, playerId, shots = []) {
  console.log('startBattle()', role);
  document.body.classList.add('in-game');

  const container = document.getElementById('gameContainer');
  container.classList.remove('hidden');
  container.innerHTML = '';

  // Заголовок
  const title = document.createElement('h2');
  title.id = 'game-title';
  title.textContent = 'Ожидание ответа сервера ⏳';
  container.appendChild(title);

  // Создаём обёртку, чтобы расположить поля рядом
  const wrapper = document.createElement('div');
  wrapper.id = 'battleWrapper';
  wrapper.style.display = 'flex';
  wrapper.style.gap = '20px';
  wrapper.style.flexDirection = 'column';
  container.appendChild(wrapper);

  // Создаём кнопку выхода
  const exitBtn = document.createElement('button');
  exitBtn.id = 'exitBtn';
  exitBtn.title = 'Вернуться к выбору комнаты';
  wrapper.appendChild(exitBtn);

  // make utochka
  // const duckDiv = document.createElement('div');
  // duckDiv.id = 'duck-container';
  // wrapper.appendChild(duckDiv);

  // Обработка кнопки "Выход"
  exitBtn.onclick = () => {
    teardown();
  };

  // Поле игрока
  const myField = document.createElement('div');
  myField.id = 'myField';
  myField.className = 'gridMini';
  wrapper.appendChild(myField);
  buildGrid(myField, 11);

  // рисуем спрайт для каждого корабля
  Object.values(fleet).forEach(coords => {
    placeSunkShip(myField, coords);
  });


  // Сделать поле игрока некликабельным
  myField.style.pointerEvents = 'none';

  // Поле противника
  const enemyField = document.createElement('div');
  enemyField.id = 'enemyField';
  enemyField.className = 'grid';
  wrapper.appendChild(enemyField);
  buildGrid(enemyField, 11);

  initShipPanel(myField);

  // Навесим обработчики на клетки врага
  enemyField.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      cell.classList.add('stop-events');
      const x = +cell.dataset.x;
      const y = +cell.dataset.y;
      console.log(`Выстрел по (${x}, ${y})`);

      // отправка выстрела на сервер
      socket.send(JSON.stringify({
        type: 'shoot',
        secret_id, role, playerId,
        x, y
      }));
    });
  });

  // Восстанавливаем все предыдущие выстрелы
  shots.forEach(({ x, y, isHit, by, sunk }) => {
    const targetField = (by === role) ? enemyField : myField;
    const cell = targetField.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (cell) cell.classList.add(isHit ? 'hit' : 'miss');


    if (sunk) {
      const ringField = (by === role) ? enemyField : myField;
      placeSunkShip(ringField, sunk.coords);
      if (sunk && by === role) {
        updateShipPanel(myField, sunk.coords.length);
      }
      const deltas = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
      sunk.coords.forEach(({ x: sx, y: sy }) => {
        deltas.forEach(([dx, dy]) => {
          const nx = sx + dx, ny = sy + dy;
          const ringCell = ringField.querySelector(`.cell[data-x="${nx}"][data-y="${ny}"]`);
          if (ringCell && !ringCell.classList.contains('hit')) {
            ringCell.classList.add('miss');
          }
        });
      });
    }
  });
}

// Рисует мини‑корабль над полем field по массиву его координат coords.
// coords — [{x, y}, …] в любой последовательности.
export function placeSunkShip(field, coords) {
  const length = coords.length;

  if (!length) return;

  const orientation = coords.every(c => c.x === coords[0].x)
    ? 'vertical'
    : 'horizontal';

  // Якори по верхней/левой клетке
  let anchor;
  if (orientation === 'horizontal') {
    const y = coords[0].y;
    const minX = Math.min(...coords.map(c => c.x));
    anchor = { x: minX, y };
  } else {
    const x = coords[0].x;
    const minY = Math.min(...coords.map(c => c.y));
    anchor = { x, y: minY };
  }

  // Получаем DOM‑ячейку‑якорь
  const cell = field.querySelector(
    `.cell[data-x="${anchor.x}"][data-y="${anchor.y}"]`
  );
  if (!cell) return;

  // Смещение внутри контейнера
  const gridRect = field.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  const offsetX = rect.left - gridRect.left;
  const offsetY = rect.top - gridRect.top;

  // Решаем, какой класс использовать
  const isEnemy = field.id === 'enemyField';
  // — для enemyField: full-size .placed-ship
  // — для myField: mini .placed-ship-mini
  const cls = isEnemy ? 'placed-ship' : 'placed-ship-mini';

  // Создаём спрайт
  const shipEl = document.createElement('div');
  shipEl.classList.add(cls);
  shipEl.dataset.length = length;
  shipEl.dataset.orientation = orientation;

  shipEl.style.left = offsetX + 'px';
  shipEl.style.top = offsetY + 'px';

  field.appendChild(shipEl);
}

export function playExplosion(cell, frameDuration = 60, isHit, preloadedFire, preloadedMiss) {
  const frames = isHit ? preloadedFire : preloadedMiss;
  const totalFrames = frames.length;

  // Создаём canvas того же размера, что и кадр
  const cw = frames[0].naturalWidth;
  const ch = frames[0].naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.className = 'explosion-canvas';       // для стилей (position/названия)

  // Относительное позиционирование контейнера
  const prevPos = getComputedStyle(cell).position;
  if (prevPos === 'static' || !prevPos) {
    cell.style.position = 'relative';
    canvas.dataset.resetPos = 'true';
  }
  cell.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let startTime = null;

  function step(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    const idx = Math.min(Math.floor(elapsed / frameDuration), totalFrames - 1);

    // Рисуем текущий кадр
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(frames[idx], 0, 0);

    if (idx < totalFrames - 1) {
      requestAnimationFrame(step);
    } else {
      // Конец анимации
      canvas.remove();
      if (canvas.dataset.resetPos) {
        cell.style.position = '';
      }
    }
  }

  requestAnimationFrame(step);
}


// Создаёт панель кораблей с изначальными счётчиками
function initShipPanel(field) {
  // Позиции для мини-кораблей на панели
  const SHIP_POSITIONS = {
    4: { right: '0px', top: '60px' },
    3: { right: '60px', top: '135px' },
    2: { right: '60px', top: '60px' },
    1: { right: '0px', top: '173px' }
  };
  const initial = { 4: 1, 3: 2, 2: 3, 1: 4 };

  Object.entries(initial).forEach(([len, count]) => {
    const shipDiv = document.createElement('div');
    shipDiv.className = 'placed-ship-mini placed-ship-mini-counter';
    shipDiv.dataset.length = len;
    shipDiv.dataset.orientation = 'vertical';
    shipDiv.style.position = 'absolute';
    shipDiv.style.right = SHIP_POSITIONS[len].right;
    shipDiv.style.top = SHIP_POSITIONS[len].top;

    const counter = document.createElement('span');
    counter.className = 'ship-counter';
    counter.textContent = count;

    shipDiv.appendChild(counter);
    field.appendChild(shipDiv);
  });
}

// Уменьшает счётчик затонувшего корабля заданной длины
export function updateShipPanel(field, len, animation) {
  const shipDiv = field.querySelector(`.placed-ship-mini-counter[data-length="${len}"]`);
  if (!shipDiv) return;                      // защитная проверка
  const counter = shipDiv.querySelector('.ship-counter');
  if (!counter) return;

  // Парсим текущее значение и уменьшаем
  let remaining = parseInt(counter.textContent, 10) - 1;

  if (remaining <= 0) {
    // если больше нет — полупрозрачный и прячем число
    shipDiv.style.opacity = '0.5';
    counter.remove();
  } else {
    counter.textContent = remaining;
    if (animation) {
      // анимация «пересчёта»
      counter.classList.add('animate-count');
      counter.addEventListener(
        'animationend',
        () => counter.classList.remove('animate-count'),
        { once: true }
      );
    }
  }
}
