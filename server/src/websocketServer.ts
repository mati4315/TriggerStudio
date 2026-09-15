import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import path from 'path';
import fs from 'fs';
import { OBSController } from './obsController';

interface ClientMessage {
  action: 'play' | 'stop' | 'hide' | 'status' | 'ended';
  video?: string;      // Simple format
  asset?: string;      // Structured format
  type?: 'video' | 'image' | 'audio';
  category?: string;   // Category of the asset
  duration?: number;   // Auto-hide duration in seconds
  sceneName?: string;
  sourceName?: string;
  mute?: boolean;
}

export class TriggerWebSocketServer {
  private wss: WebSocketServer;
  private obsController: OBSController;
  private mediaPath: string;
  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private activeAssets: Map<string, { asset: string; type: 'video' | 'image' | 'audio'; startedAt: number; category?: string; mute?: boolean }> = new Map();

  constructor(server: Server, obsController: OBSController, mediaPath: string) {
    this.obsController = obsController;
    this.mediaPath = mediaPath;
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WS] Client connected');
      
      // Send initial status
      this.sendConnectionStatus(ws);

      ws.on('message', async (message: string) => {
        try {
          const data: ClientMessage = JSON.parse(message);
          console.log('[WS] Received message:', data);
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error('[WS] Error parsing message:', error);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON format' }));
        }
      });

      ws.on('close', () => {
        console.log('[WS] Client disconnected');
      });
    });

    // Register media playback ended event from OBS to automatically finish/clear any media
    this.obsController.onMediaEnded(async (inputName: string) => {
      console.log(`[OBS Event] Media playback ended on source: "${inputName}". Auto-stopping to continue stream...`);
      
      const activeScene = await this.obsController.getCurrentSceneName();
      const sceneName = process.env.OBS_SCENE || activeScene;
      
      this.activeAssets.delete(inputName);
      this.broadcastMediaStatus(sceneName, inputName, 'hidden');
      
      // Clear any active auto-hide timeouts for this source if they exist
      const timeoutKey = `${sceneName}:${inputName}`;
      if (this.activeTimeouts.has(timeoutKey)) {
        clearTimeout(this.activeTimeouts.get(timeoutKey)!);
        this.activeTimeouts.delete(timeoutKey);
      }

      // Stop the media in OBS to reset and clear playback completely
      await this.obsController.stopAsset(inputName);
    });

    // Periodically broadcast status to all clients
    setInterval(() => {
      this.broadcastStatus();
    }, 5000);
  }

  private sendConnectionStatus(ws: WebSocket) {
    const status = this.obsController.getStatus();
    ws.send(JSON.stringify({
      type: 'status',
      obsConnected: status.connected,
      obsUrl: status.url,
      mediaPath: this.mediaPath,
      activeAssets: Array.from(this.activeAssets.entries()).map(([source, data]) => ({
        source,
        ...data
      }))
    }));
  }

  private broadcastStatus() {
    const status = this.obsController.getStatus();
    const message = JSON.stringify({
      type: 'status',
      obsConnected: status.connected,
      obsUrl: status.url,
      mediaPath: this.mediaPath,
      activeAssets: Array.from(this.activeAssets.entries()).map(([source, data]) => ({
        source,
        ...data
      }))
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private async handleMessage(ws: WebSocket, msg: ClientMessage) {
    const activeScene = await this.obsController.getCurrentSceneName();
    const sceneName = msg.sceneName || process.env.OBS_SCENE || activeScene;
    const defaultVideoSource = process.env.OBS_SOURCE_VIDEO || 'Overlay_Main';
    const defaultImageSource = process.env.OBS_SOURCE_IMAGE || 'GIF_Overlay';
    const defaultAudioSource = process.env.OBS_SOURCE_AUDIO || 'Sound_Effect';

    if (msg.action === 'status') {
      this.sendConnectionStatus(ws);
      return;
    }

    if (msg.action === 'ended') {
      const sourceName = msg.sourceName || defaultVideoSource;
      console.log(`[WS] Client reported media ended on source: ${sourceName}`);
      if (this.activeAssets.has(sourceName)) {
        this.activeAssets.delete(sourceName);
        this.broadcastMediaStatus(sceneName, sourceName, 'hidden');
      }
      return;
    }

    if (msg.action === 'play') {
      // Determine file path and type
      let fileName = msg.video || msg.asset;
      if (!fileName) {
        ws.send(JSON.stringify({ type: 'error', message: 'No media file specified' }));
        return;
      }

      // Detect type
      const ext = path.extname(fileName).toLowerCase();
      const imageExtensions = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'];
      const videoExtensions = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'];
      const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
      
      let isVideo = true;
      let isAudio = false;
      if (msg.type === 'image') {
        isVideo = false;
      } else if (msg.type === 'video') {
        isVideo = true;
      } else if (msg.type === 'audio') {
        isVideo = false;
        isAudio = true;
      } else if (imageExtensions.includes(ext)) {
        isVideo = false;
      } else if (videoExtensions.includes(ext)) {
        isVideo = true;
      } else if (audioExtensions.includes(ext)) {
        isVideo = false;
        isAudio = true;
      }

      // Determine the target sourceName (with intelligent fallback)
      let sourceName = msg.sourceName;
      if (!sourceName) {
        if (isAudio) {
          const audioSourceExists = await this.obsController.sourceExistsInScene(sceneName, defaultAudioSource);
          if (audioSourceExists) {
            sourceName = defaultAudioSource;
          } else {
            console.log(`[WS] Audio source "${defaultAudioSource}" not found in scene "${sceneName}". Falling back to video source "${defaultVideoSource}"`);
            sourceName = defaultVideoSource;
          }
        } else if (isVideo) {
          sourceName = defaultVideoSource;
        } else {
          // If it's an image/gif, check if defaultImageSource is in the scene.
          // Otherwise, fall back to defaultVideoSource.
          const imageSourceExists = await this.obsController.sourceExistsInScene(sceneName, defaultImageSource);
          if (imageSourceExists) {
            sourceName = defaultImageSource;
          } else {
            console.log(`[WS] Image source "${defaultImageSource}" not found in scene "${sceneName}". Falling back to video source "${defaultVideoSource}"`);
            sourceName = defaultVideoSource;
          }
        }
      }

      // Locate the file in mediaPath
      const resolvedPath = this.resolveFilePath(fileName);
      if (!resolvedPath) {
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: `File "${fileName}" not found in media folder: ${this.mediaPath}` 
        }));
        return;
      }

      // Cancel existing auto-hide timeouts for this source if any
      const timeoutKey = `${sceneName}:${sourceName}`;
      if (this.activeTimeouts.has(timeoutKey)) {
        clearTimeout(this.activeTimeouts.get(timeoutKey)!);
        this.activeTimeouts.delete(timeoutKey);
      }

      // Audio is played as a media source in OBS (isVideo = true)
      const playAsVideo = isVideo || isAudio;

      // Determine mute state:
      // Default for videos (except Noticias): MUTED (true)
      // Default for Noticias: UNMUTED (false)
      // Default for Audios: UNMUTED (false)
      const isNoticias = msg.category === 'Noticias' || fileName.toLowerCase().includes('noticia');
      const defaultMute = isVideo && !isNoticias;
      const mute = msg.mute !== undefined ? !!msg.mute : defaultMute;

      const result = await this.obsController.playAsset(sceneName, sourceName, resolvedPath, playAsVideo, mute);
      if (result.success) {
        const isStaticImage = !isVideo && !isAudio && ext !== '.gif';
        const msgText = isStaticImage 
          ? `Playing ${fileName} on ${sourceName} (Static Image: 2s limit enforced)` 
          : `Playing ${fileName} on ${sourceName}${mute ? ' [Silenciado]' : ''}`;
        ws.send(JSON.stringify({ type: 'success', message: msgText }));
        if (result.warning) {
          ws.send(JSON.stringify({ type: 'warning', message: result.warning }));
        }

        // Track active asset
        this.activeAssets.set(sourceName, {
          asset: fileName,
          type: isAudio ? 'audio' : (isVideo ? 'video' : 'image'),
          category: msg.category,
          startedAt: Date.now(),
          mute: mute
        });

        // Broadcast that it is playing
        this.broadcastMediaStatus(sceneName, sourceName, 'playing', fileName, msg.category, mute);

        // Handle auto-finish / timeout:
        // - Static images: 3s if duration is 0
        // - GIFs: 4s if duration is 0
        // - Custom duration if specified (>0)
        let effectiveDuration = msg.duration || 0;
        if (effectiveDuration <= 0) {
          if (isStaticImage) {
            effectiveDuration = 3;
          } else if (!isVideo && !isAudio) {
            effectiveDuration = 4; // GIF auto-finish
          }
        }

        if (effectiveDuration > 0) {
          const timeout = setTimeout(async () => {
            console.log(`[Auto-Finish] Duration reached (${effectiveDuration}s) for "${fileName}". Auto-stopping...`);
            await this.obsController.stopAsset(sourceName);
            this.activeTimeouts.delete(timeoutKey);
            this.activeAssets.delete(sourceName);
            this.broadcastMediaStatus(sceneName, sourceName, 'hidden');
          }, effectiveDuration * 1000);
          
          this.activeTimeouts.set(timeoutKey, timeout);
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', message: result.error || `OBS failed to play ${fileName}` }));
      }
      return;
    }

    if (msg.action === 'stop' || msg.action === 'hide') {
      // Clear all active timeouts
      for (const timeout of this.activeTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.activeTimeouts.clear();

      const sourceName = msg.sourceName;
      if (sourceName) {
        await this.obsController.stopAsset(sourceName);
        this.activeAssets.delete(sourceName);
        this.broadcastMediaStatus(sceneName, sourceName, 'hidden');
      } else {
        // Emergency stop: stop all media in the scene without disabling any source
        await this.obsController.stopAllAssets(sceneName);
        
        // Also stop default configured sources
        await this.obsController.stopAsset(defaultVideoSource);
        await this.obsController.stopAsset(defaultImageSource);
        
        this.activeAssets.clear();

        this.broadcastMediaStatus(sceneName, defaultVideoSource, 'hidden');
        this.broadcastMediaStatus(sceneName, defaultImageSource, 'hidden');

        // Broadcast general stop to clear all active cards and stop overlay
        this.broadcastAllAssetsStopped();
      }
      ws.send(JSON.stringify({ type: 'success', message: 'All playback stopped' }));
      return;
    }
  }

  private broadcastAllAssetsStopped() {
    const msg = JSON.stringify({
      type: 'all_stopped'
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  private broadcastMediaStatus(sceneName: string, sourceName: string, state: 'playing' | 'hidden', assetName?: string, category?: string, mute?: boolean) {
    const msg = JSON.stringify({
      type: 'media_state',
      sceneName,
      sourceName,
      state,
      assetName,
      category,
      mute
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  private resolveFilePath(fileName: string): string | null {
    // 1. Direct path check
    let fullPath = path.join(this.mediaPath, fileName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }

    // 2. Normalized path check
    const normalized = fileName.replace(/\\/g, '/');

    // 3. Search recursively inside mediaPath
    const findRecursive = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (item === '.thumbnails' || item.startsWith('.')) continue;
        const currentPath = path.join(dir, item);
        const stat = fs.statSync(currentPath);
        if (stat.isDirectory()) {
          const res = findRecursive(currentPath);
          if (res) return res;
        } else if (stat.isFile()) {
          const rel = path.relative(this.mediaPath, currentPath).replace(/\\/g, '/');
          if (rel === normalized || item.toLowerCase() === path.basename(normalized).toLowerCase()) {
            return currentPath;
          }
        }
      }
      return null;
    };

    return findRecursive(this.mediaPath);
  }
}
