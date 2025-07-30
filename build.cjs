const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const obfuscator = require('javascript-obfuscator');
const { execSync } = require('child_process');

function getJSFilesFrom(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f));
}

function copyFiles(srcDir, destDir, exts = []) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    if (fs.statSync(srcPath).isDirectory()) {
      copyFiles(srcPath, destPath, exts);
    } else if (exts.includes(path.extname(file))) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function obfuscateDirJS(dirPath) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const code = fs.readFileSync(filePath, 'utf8');
    const obfuscated = obfuscator.obfuscate(code, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 1.0,
      numbersToExpressions: true,
      simplify: true,
      stringArrayShuffle: true,
      splitStrings: true,
      stringArrayThreshold: 1.0,
    });
    fs.writeFileSync(filePath, obfuscated.getObfuscatedCode());
  }
}

(async () => {
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
    console.log('🧹 Папка dist удалена');
  }

  // === Сборка PUBLIC ===
  await esbuild.build({
    entryPoints: getJSFilesFrom('public'),
    outdir: 'dist/public',
    minify: true,
    bundle: false,
    sourcemap: false,
    target: ['es2018'],
  });
  console.log('✅ Frontend собран');

  // копируем изображения
  copyFiles('public', 'dist/public', ['.png', '.svg']);
  obfuscateDirJS('dist/public');

  // === Сборка SERVER ===
  await esbuild.build({
    entryPoints: getJSFilesFrom('server'),
    outdir: 'dist/server',
    minify: true,
    bundle: false,
    sourcemap: false,
    target: ['node18'],
    platform: 'node',
  });
  console.log('✅ Backend собран');

  obfuscateDirJS('dist/server');

  console.log('🎉 Готово: всё собрано, минифицировано и обфусцировано!');

  // Минификация CSS
  execSync('node minify-css.cjs', { stdio: 'inherit' });

  // Минификация HTML
  execSync('node minify-html.cjs', { stdio: 'inherit' });

  // Копируем package.json и package-lock.json
  fs.copyFileSync(path.join(__dirname, 'package.json'), path.join(distPath, 'package.json'));
  fs.copyFileSync(path.join(__dirname, 'package-lock.json'), path.join(distPath, 'package-lock.json'));

  console.log('📦 Скопированы package.json и package-lock.json');
})();
