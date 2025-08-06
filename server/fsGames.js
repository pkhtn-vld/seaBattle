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
