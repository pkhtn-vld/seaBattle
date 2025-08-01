// preload.js

// подставляем origin, чтобы img.src и CSS url() совпадали
const BASE = window.location.origin + '/images/';

// Загружает одну картинку и ждёт, пока она декодируется
function preloadImage(filename) {
  const img = new Image();
  img.src = BASE + filename;      // <– filename: "ship-1-g.png"
  return img.decode().then(() => img);
}

// Получаем статичные файлы из manifest.json
async function collectStaticImages() {
  const res = await fetch('/manifest.json');
  if (!res.ok) throw new Error('manifest.json не доступен');
  return await res.json();        // массив ["back.png", ...]
}

// Предзагружает все необходимые картинки
export async function preloadAll() {
  // кадры анимации
  const fire = Array.from({ length: 14 }, (_, i) => `fire${i+1}.png`);
  const miss = Array.from({ length:  7 }, (_, i) => `miss${i+1}.png`);
  // всё из manifest
  const statics = await collectStaticImages(); // ["back.png","ship-1-g.png",...]
  // объединяем и убираем дубли
  const allFiles = Array.from(new Set([...fire, ...miss, ...statics]));
  // preload
  const images = await Promise.all(allFiles.map(preloadImage));
  // мапим
  const all = {};
  images.forEach(img => {
    const name = img.src.slice(BASE.length);
    all[name] = img;
  });
  // возвращаем
  return {
    all,
    fireFrames: fire.map(n => all[n]),
    missFrames: miss.map(n => all[n])
  };
}