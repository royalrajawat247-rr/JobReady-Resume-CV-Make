const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const icon192 = path.join(root, 'public', 'icons', 'icon-192x192.png');
const icon512 = path.join(root, 'public', 'icons', 'icon-512x512.png');
if (!fs.existsSync(icon192) || !fs.existsSync(icon512)) {
  execFileSync(process.execPath, [path.join(__dirname, 'generate-icons.js')], { stdio: 'inherit' });
}

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
  fs.cpSync(publicDir, dist, { recursive: true, force: true });
}

console.log('Static build complete -> dist/');
