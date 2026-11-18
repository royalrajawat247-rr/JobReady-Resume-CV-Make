const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const staticFiles = ['index.html', 'manifest.json', 'sw.js', 'favicon.ico'];
for (const file of staticFiles) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dist, file));
  }
}

const publicDir = path.join(root, 'public');
if (fs.existsSync(publicDir)) {
  for (const entry of fs.readdirSync(publicDir)) {
    const src = path.join(publicDir, entry);
    const dest = path.join(dist, entry);
    if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

console.log('Static build complete -> dist/');
