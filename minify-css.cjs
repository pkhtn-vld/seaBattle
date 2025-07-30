const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');

const inputPath = path.join(__dirname, 'public', 'style.css');
const outputPath = path.join(__dirname, 'dist/public', 'style.css');

const css = fs.readFileSync(inputPath, 'utf8');
const output = new CleanCSS({
  level: 2
}).minify(css);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output.styles);
console.log('✅ CSS минифицирован');
