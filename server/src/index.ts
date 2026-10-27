import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { OBSController } from './obsController';
import { TriggerWebSocketServer } from './websocketServer';
import { AssetScanner } from './assetScanner';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
let MEDIA_PATH = process.env.MEDIA_PATH || path.join(__dirname, '../media');
const execFileAsync = promisify(execFile);
const mediaConfigPath = path.join(__dirname, '../media-folder.json');
const videoExtensions = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v']);
const compressionsInProgress = new Set<string>();
type CompressionMode = 'keep' | '720p';
type CompressionJobResult = { file: string; originalBytes: number; compressedBytes: number; savedPercent: number; mode: CompressionMode };
type CompressionJob = {
  id: string;
  sourcePath: string;
  relativePath: string;
  tempPath: string;
  backupPath: string;
  lockKey: string;
  originalBytes: number;
  mode: CompressionMode;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  phase: string;
  updatedAt: number;
  error?: string;
  result?: CompressionJobResult;
};
const compressionJobs = new Map<string, CompressionJob>();
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

try {
  const savedMediaPath = JSON.parse(fs.readFileSync(mediaConfigPath, 'utf8')).mediaPath;
  if (typeof savedMediaPath === 'string' && savedMediaPath.trim()) MEDIA_PATH = path.resolve(savedMediaPath);
} catch { /* First run: use MEDIA_PATH from .env. */ }

// Ensure media path exists
function initializeMediaFolder(createDefaultFolders = true) {
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

  if (!createDefaultFolders) return;

  // Create standard subdirectories
  const subdirs = ['videos', 'gifs', 'memes', 'overlays', 'sounds', 'noticias'];
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
      } else if (subdir === 'noticias') {
        fs.writeFileSync(path.join(subdirPath, 'noticia_demo.mp4'), '');
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
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
app.use(express.static(path.join(__dirname, '../public')));
app.use('/media', (req, res, next) => express.static(MEDIA_PATH, { dotfiles: 'allow' })(req, res, next));
app.use(express.json());

function isLocalRequest(req: express.Request) {
  const address = req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

app.post('/api/media-folder/select', async (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Esta opción solo está disponible en el PC donde se ejecuta TriggerStudio.' });
  try {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Selecciona la carpeta principal de medios para TriggerStudio'",
      '$dialog.ShowNewFolderButton = $true',
      `$dialog.SelectedPath = '${MEDIA_PATH.replace(/'/g, "''")}'`,
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }'
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], { windowsHide: true, timeout: 120000 });
    const selectedPath = stdout.trim();
    if (!selectedPath) return res.json({ cancelled: true });
    const resolvedPath = path.resolve(selectedPath);
    fs.mkdirSync(resolvedPath, { recursive: true });
    fs.writeFileSync(mediaConfigPath, JSON.stringify({ mediaPath: resolvedPath }, null, 2));
    MEDIA_PATH = resolvedPath;
    scanner.setMediaPath(MEDIA_PATH);
    wsServer.setMediaPath(MEDIA_PATH);
    res.json({ mediaPath: MEDIA_PATH });
  } catch (error: any) {
    console.error('[Media] Could not select media folder:', error);
    res.status(500).json({ error: 'No se pudo abrir el selector de carpetas.' });
  }
});

app.post('/api/media-folder/open', async (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Esta opción solo está disponible en el PC donde se ejecuta TriggerStudio.' });
  try {
    await execFileAsync('explorer.exe', [MEDIA_PATH], { windowsHide: true, timeout: 10000 });
    res.json({ mediaPath: MEDIA_PATH });
  } catch (error: any) {
    // Explorer launches independently and may not keep a child process handle.
    if (error.code === 'ETIMEDOUT') return res.json({ mediaPath: MEDIA_PATH });
    console.error('[Media] Could not open media folder:', error);
    res.status(500).json({ error: 'No se pudo abrir la carpeta en el Explorador de archivos.' });
  }
});

// API: List assets
app.get('/api/assets', (req, res) => {
  const assets = scanner.scan();
  res.json(assets);
});

// Re-read the current size and modification time from disk before compression.
app.post('/api/media/analyze', (req, res) => {
  const file = typeof req.body?.file === 'string' ? req.body.file.trim() : '';
  if (!file) return res.status(400).json({ error: 'Selecciona un video para analizar.' });

  const mediaRoot = path.resolve(MEDIA_PATH);
  const sourcePath = path.resolve(mediaRoot, file);
  const relativeSource = path.relative(mediaRoot, sourcePath);
  if (!relativeSource || relativeSource === '..' || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)) {
    return res.status(400).json({ error: 'La ruta del video no es válida.' });
  }
  if (!videoExtensions.has(path.extname(sourcePath).toLowerCase())) {
    return res.status(400).json({ error: 'Solo se pueden analizar archivos de video compatibles.' });
  }

  try {
    const realRoot = fs.realpathSync(mediaRoot);
    const realSourcePath = fs.realpathSync(sourcePath);
    const realRelative = path.relative(realRoot, realSourcePath);
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      return res.status(400).json({ error: 'El video no pertenece a la biblioteca multimedia.' });
    }
    const stat = fs.statSync(realSourcePath);
    if (!stat.isFile()) return res.status(400).json({ error: 'La ruta seleccionada no es un archivo.' });
    res.json({ file: relativeSource.replace(/\\/g, '/'), sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() });
  } catch (error: any) {
    res.status(404).json({ error: 'No se pudo leer el archivo. Comprueba que siga en la biblioteca multimedia.' });
  }
});

function compressionErrorMessage(error: any) {
  const detail = String(error?.message || error || 'Error desconocido')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' · ')
    .slice(0, 360);
  return `FFmpeg no pudo comprimir el video: ${detail}`;
}

async function executeCompressionJob(job: CompressionJob) {
  try {
    const extension = path.extname(job.sourcePath).toLowerCase();
    const isWebm = extension === '.webm';
    const outputOptions = isWebm
      ? ['-map 0:v:0', '-map 0:a?', '-c:v libvpx-vp9', `-crf ${job.mode === '720p' ? 34 : 32}`, '-b:v 0', '-deadline good', '-cpu-used 2', '-pix_fmt yuv420p', '-c:a libopus', '-b:a 128k', '-map_metadata 0']
      : ['-map 0:v:0', '-map 0:a?', '-c:v libx264', '-preset medium', `-crf ${job.mode === '720p' ? 25 : 24}`, '-pix_fmt yuv420p', '-c:a aac', '-b:a 160k', '-map_metadata 0'];

    if (['.mp4', '.mov', '.m4v'].includes(extension)) outputOptions.push('-movflags +faststart');
    let command = ffmpeg(job.sourcePath).outputOptions(outputOptions);
    if (job.mode === '720p') {
      // Bundled FFmpeg is an older build without scale's force_divisible_by option.
      // Compute even dimensions directly while keeping aspect ratio and never upscaling.
      command = command.videoFilters(
        "scale=w='trunc(iw*min(1,if(gte(iw,ih),min(1280/iw,720/ih),min(720/iw,1280/ih)))/2)*2':h='trunc(ih*min(1,if(gte(iw,ih),min(1280/iw,720/ih),min(720/iw,1280/ih)))/2)*2'"
      );
    }

    job.phase = 'Iniciando compresión…';
    job.updatedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      command
        .on('progress', progress => {
          const percent = Number(progress.percent);
          if (Number.isFinite(percent)) job.progress = Math.min(98, Math.max(job.progress, Math.round(percent)));
          const fps = Number(progress.currentFps);
          job.phase = Number.isFinite(percent)
            ? `Comprimiendo · ${Math.round(percent)}%${fps > 0 ? ` · ${Math.round(fps)} fps` : ''}`
            : 'Comprimiendo video…';
          job.updatedAt = Date.now();
        })
        .on('error', reject)
        .on('end', () => resolve())
        .save(job.tempPath);
    });

    const compressedStat = fs.statSync(job.tempPath);
    if (!compressedStat.isFile() || compressedStat.size <= 0) throw new Error('FFmpeg terminó sin generar un video válido.');

    job.phase = 'Reemplazando el original…';
    job.progress = 99;
    job.updatedAt = Date.now();
    fs.renameSync(job.sourcePath, job.backupPath);
    try {
      fs.renameSync(job.tempPath, job.sourcePath);
    } catch (error) {
      try { fs.renameSync(job.backupPath, job.sourcePath); } catch (restoreError: any) {
        throw new Error(`No se pudo instalar el video comprimido y tampoco restaurar el original. Conservado en ${job.backupPath}. ${restoreError.message}`);
      }
      throw error;
    }

    try { fs.unlinkSync(job.backupPath); }
    catch (error: any) { console.warn(`[Media] Could not remove temporary original backup: ${error.message}`); }

    const finalStat = fs.statSync(job.sourcePath);
    job.result = {
      file: job.relativePath,
      originalBytes: job.originalBytes,
      compressedBytes: finalStat.size,
      savedPercent: Math.round((job.originalBytes - finalStat.size) / job.originalBytes * 100),
      mode: job.mode
    };
    job.progress = 100;
    job.phase = 'Video reemplazado y listo';
    job.status = 'completed';
  } catch (error: any) {
    if (fs.existsSync(job.tempPath)) {
      try { fs.unlinkSync(job.tempPath); } catch { /* Keep the original and report the FFmpeg/IO error. */ }
    }
    job.error = compressionErrorMessage(error);
    job.phase = 'No se pudo completar';
    job.status = 'failed';
    console.error(`[Media] Video compression failed for ${path.basename(job.sourcePath)}:`, error.message);
  } finally {
    compressionsInProgress.delete(job.lockKey);
    job.updatedAt = Date.now();
    const cleanupTimer = setTimeout(() => compressionJobs.delete(job.id), 60 * 60 * 1000);
    cleanupTimer.unref();
  }
}

// Compress in the background so the panel can show progress while FFmpeg runs.
app.post('/api/media/compress', (req, res) => {
  const file = typeof req.body?.file === 'string' ? req.body.file.trim() : '';
  const mode = req.body?.mode;
  if (!file || (mode !== 'keep' && mode !== '720p')) {
    return res.status(400).json({ error: 'Selecciona un video y un modo de compresión válido.' });
  }

  const mediaRoot = path.resolve(MEDIA_PATH);
  const sourcePath = path.resolve(mediaRoot, file);
  const relativeSource = path.relative(mediaRoot, sourcePath);
  if (!relativeSource || relativeSource === '..' || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)) {
    return res.status(400).json({ error: 'La ruta del video no es válida.' });
  }
  if (!videoExtensions.has(path.extname(sourcePath).toLowerCase())) {
    return res.status(400).json({ error: 'Solo se pueden comprimir archivos de video compatibles.' });
  }

  try {
    const realRoot = fs.realpathSync(mediaRoot);
    const realSourcePath = fs.realpathSync(sourcePath);
    const realRelative = path.relative(realRoot, realSourcePath);
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      return res.status(400).json({ error: 'La ruta del video no pertenece a la biblioteca multimedia.' });
    }
    const lockKey = realSourcePath.toLowerCase();
    if (compressionsInProgress.has(lockKey)) return res.status(409).json({ error: 'Este video ya se está comprimiendo.' });

    const inputStat = fs.statSync(realSourcePath);
    if (!inputStat.isFile() || inputStat.size <= 0) {
      return res.status(400).json({ error: 'El archivo de video está vacío o no se puede leer.' });
    }

    const parsed = path.parse(realSourcePath);
    const id = randomUUID();
    const job: CompressionJob = {
      id,
      sourcePath: realSourcePath,
      relativePath: path.relative(realRoot, realSourcePath).replace(/\\/g, '/'),
      tempPath: path.join(parsed.dir, `.triggerstudio-${id}${parsed.ext.toLowerCase()}`),
      backupPath: path.join(parsed.dir, `.triggerstudio-${id}.backup`),
      lockKey: realSourcePath.toLowerCase(),
      originalBytes: inputStat.size,
      mode,
      status: 'running',
      progress: 0,
      phase: 'Preparando video…',
      updatedAt: Date.now()
    };
    compressionsInProgress.add(job.lockKey);
    compressionJobs.set(id, job);
    void executeCompressionJob(job);
    res.status(202).json({ jobId: id });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'No se pudo preparar la compresión del video.' });
  }
});

app.get('/api/media/compress/:jobId', (req, res) => {
  const job = compressionJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'No se encontró el proceso de compresión.' });
  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    error: job.error,
    result: job.result
  });
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
