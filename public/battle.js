// public/battle.js
import { buildGrid } from './setup.js';

export function startBattle(role, fleet, teardown, socket, secret_id, playerId, shots = []) {
  console.log('startBattle()', role);

  const container = document.getElementById('gameContainer');
  container.classList.remove('hidden');
  container.innerHTML = '';

  // Создаём обёртку, чтобы расположить поля рядом
  const wrapper = document.createElement('div');
  wrapper.id = 'battleWrapper';
  wrapper.style.display = 'flex';
  wrapper.style.gap = '20px';
  wrapper.style.flexDirection = 'column';
  wrapper.style.position = 'relative';
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
  myField.className = 'grid';
  wrapper.appendChild(myField);
  buildGrid(myField, 11);

  // Рисуем корабли на myField
  Object.values(fleet).flat().forEach(({ x, y }) => {
    const cell = myField.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (cell) cell.classList.add('ship');
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
      // то же, что у вас в handleServerMessage для sunk
      const ringField = (by === role) ? enemyField : myField;
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
