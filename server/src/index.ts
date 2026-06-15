import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { OBSController } from './obsController';
import { TriggerWebSocketServer } from './websocketServer';
import { AssetScanner } from './assetScanner';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
let MEDIA_PATH = process.env.MEDIA_PATH || path.join(__dirname, '../media');

// Ensure media path exists
function initializeMediaFolder() {
  // If the path configured is the default D:/OBS_MEDIA and it doesn't exist,
  // we default to local ./media folder.
  if (process.env.MEDIA_PATH === 'D:/OBS_MEDIA' && !fs.existsSync('D:/OBS_MEDIA')) {
    console.log('\x1b[33m[System] D:/OBS_MEDIA directory does not exist. Falling back to local "./media" folder.\x1b[0m');
    MEDIA_PATH = path.join(__dirname, '../media');
  }

  if (!fs.existsSync(MEDIA_PATH)) {
    console.log(`[System] Creating media directory at: ${MEDIA_PATH}`);
    fs.mkdirSync(MEDIA_PATH, { recursive: true });
  }

  // Create standard subdirectories
  const subdirs = ['videos', 'gifs', 'memes', 'overlays', 'sounds'];
  subdirs.forEach(subdir => {
    const subdirPath = path.join(MEDIA_PATH, subdir);
    if (!fs.existsSync(subdirPath)) {
      fs.mkdirSync(subdirPath, { recursive: true });
      // Create a dummy file in each for visual scanner verification
      fs.writeFileSync(
        path.join(subdirPath, `readme_instrucciones.txt`),
        `Coloque sus archivos de tipo ${subdir} aquí.`
      );
      // Let's create a dummy asset so they have something to click out of the box!
      if (subdir === 'videos') {
        fs.writeFileSync(path.join(subdirPath, 'video_demo.mp4'), '');
      } else if (subdir === 'gifs') {
        fs.writeFileSync(path.join(subdirPath, 'gif_demo.gif'), '');
      }
    }
  });

  console.log(`\x1b[32m[System] Media folder initialized at: ${MEDIA_PATH}\x1b[0m`);
}

initializeMediaFolder();

// Instantiate OBS Controller
const obsUrl = process.env.OBS_WS_URL || 'ws://127.0.0.1:4455';
const obsPassword = process.env.OBS_WS_PASSWORD || undefined;
const obsController = new OBSController(obsUrl, obsPassword);

// Initialize scanner
const scanner = new AssetScanner(MEDIA_PATH);

// Connect to OBS
obsController.connect();

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/media', express.static(MEDIA_PATH));
app.use(express.json());

// API: List assets
app.get('/api/assets', (req, res) => {
  const assets = scanner.scan();
  res.json(assets);
});

// API: Get status
app.get('/api/status', (req, res) => {
  res.json({
    obs: obsController.getStatus(),
    mediaPath: MEDIA_PATH,
    port: PORT
  });
});

// Initialize WebSocket server
const wsServer = new TriggerWebSocketServer(server, obsController, MEDIA_PATH);

// Start HTTP server
server.listen(PORT, () => {
  console.log('\n\x1b[36m==================================================\x1b[0m');
  console.log(`\x1b[32m🚀 TriggerStudio Backend running at http://localhost:${PORT}\x1b[0m`);
  console.log(`📡 WebSocket server is listening on the same port`);
  console.log(`📂 Scanning media files from: ${MEDIA_PATH}`);
  console.log('\x1b[36m==================================================\x1b[0m\n');
});
