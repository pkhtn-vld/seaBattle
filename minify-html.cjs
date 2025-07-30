const fs = require('fs');
const path = require('path');
const { minify } = require('html-minifier-terser');

const inputPath = path.join(__dirname, 'public', 'index.html');
const outputPath = path.join(__dirname, 'dist/public', 'index.html');

const html = fs.readFileSync(inputPath, 'utf8');

minify(html, {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true
}).then(result => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result);
  console.log('✅ HTML минифицирован');
});
