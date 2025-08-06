// fsGames.js
import { promises as fs } from 'fs';
import path from 'path';

const GAMES_FOLDER = path.join('./server/games');

export async function ensureGamesFolder() {
  try {
    await fs.mkdir(GAMES_FOLDER, { recursive: true });
    // логирование по желанию
  } catch (e) {
    console.error(`Не удалось создать папку игр: ${e.message}`);
  }
}

export async function saveGame(secret_id, data) {
  const file = path.join(GAMES_FOLDER, `${secret_id}.json`);
  const text = JSON.stringify(data, null, 2);
  await fs.writeFile(file, text);
}

export async function deleteGame(secret_id) {
  const file = path.join(GAMES_FOLDER, `${secret_id}.json`);
  try {
    await fs.unlink(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

export async function loadGame(secret_id) {
  const file = path.join(GAMES_FOLDER, `${secret_id}.json`);
  try {
    const content = await fs.readFile(file, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    if (e.code === 'ENOENT') return null; // файла нет — новая игра
    throw e; // какая-то другая ошибка
  }
}

export async function restoreGame(session, secret_id) {
  const data = await loadGame(secret_id);
  if (data && data.player1 && data.player2) {
    session.battleData = data;
    session.initialFleets = {
      player1: JSON.parse(JSON.stringify(data.initialFleets.player1)),
      player2: JSON.parse(JSON.stringify(data.initialFleets.player2)),
    };
    return true;
  }
  return false;
}