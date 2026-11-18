const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const staticOpts = {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
};

app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use(express.static(path.join(__dirname), staticOpts));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`JobReady server listening on http://${HOST}:${PORT}`);
});
