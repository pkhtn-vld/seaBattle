// public/battle.js
import { buildGrid } from './setup.js';

export function startBattle(role, fleet, teardown, socket, secret_id, playerId) {
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
  buildGrid(myField, 10);

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
  buildGrid(enemyField, 10);

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
}
