// public/battle.js
import { buildGrid } from './setup.js';

export function startBattle(role, fleet, teardown, socket, secret_id, playerId, shots = []) {
  console.log('startBattle()', role);

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
  exitBtn.textContent = '↩';
  wrapper.appendChild(exitBtn);

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
  myField.style.opacity = '0.8';

  // Поле противника
  const enemyField = document.createElement('div');
  enemyField.id = 'enemyField';
  enemyField.className = 'grid';
  wrapper.appendChild(enemyField);
  buildGrid(enemyField, 11);

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

  const explosion = document.createElement('div');
  explosion.className = isHit ? 'explosion' : 'explosionUnderwater';

  // сразу первый кадр
  explosion.style.backgroundImage = `url("${frames[0].src}")`;

  // обеспечиваем относительное позиционирование контейнера
  const prevPosition = window.getComputedStyle(cell).position;
  if (prevPosition === 'static' || !prevPosition) {
    cell.style.position = 'relative';
  }
  cell.appendChild(explosion);

  let startTime = null;
  function step(timestamp) {
    if (startTime === null) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const idx = Math.floor(elapsed / frameDuration);

    if (idx < totalFrames) {
      explosion.style.backgroundImage = `url("${frames[idx].src}")`;
      requestAnimationFrame(step);
    } else {
      explosion.remove();
      if (prevPosition === 'static' || !prevPosition) {
        cell.style.position = '';
      }
    }
  }

  requestAnimationFrame(step);
}
