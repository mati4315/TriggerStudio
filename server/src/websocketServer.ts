import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import path from 'path';
import fs from 'fs';
import { OBSController } from './obsController';

interface ClientMessage {
  action: 'play' | 'stop' | 'hide' | 'status';
  video?: string;      // Simple format
  asset?: string;      // Structured format
  type?: 'video' | 'image';
  duration?: number;   // Auto-hide duration in seconds
  sceneName?: string;
  sourceName?: string;
}

export class TriggerWebSocketServer {
  private wss: WebSocketServer;
  private obsController: OBSController;
  private mediaPath: string;
  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private activeAssets: Map<string, { asset: string; type: 'video' | 'image'; startedAt: number }> = new Map();

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

    if (msg.action === 'status') {
      this.sendConnectionStatus(ws);
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
      
      let isVideo = true;
      if (msg.type === 'image') {
        isVideo = false;
      } else if (msg.type === 'video') {
        isVideo = true;
      } else if (imageExtensions.includes(ext)) {
        isVideo = false;
      } else if (videoExtensions.includes(ext)) {
        isVideo = true;
      }

      // Determine the target sourceName (with intelligent fallback)
      let sourceName = msg.sourceName;
      if (!sourceName) {
        if (isVideo) {
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

      const result = await this.obsController.playAsset(sceneName, sourceName, resolvedPath, isVideo);
      if (result.success) {
        const isStaticImage = !isVideo && ext !== '.gif';
        const msgText = isStaticImage 
          ? `Playing ${fileName} on ${sourceName} (Static Image: 2s limit enforced)` 
          : `Playing ${fileName} on ${sourceName}`;
        ws.send(JSON.stringify({ type: 'success', message: msgText }));
        if (result.warning) {
          ws.send(JSON.stringify({ type: 'warning', message: result.warning }));
        }

        // Track active asset
        this.activeAssets.set(sourceName, {
          asset: fileName,
          type: isVideo ? 'video' : 'image',
          startedAt: Date.now()
        });

        // Broadcast that it is playing
        this.broadcastMediaStatus(sceneName, sourceName, 'playing', fileName);

        // Handle auto-hide: enforce 2-second display limit only for static images
        const duration = isStaticImage ? 2 : (msg.duration || 0);
        if (duration > 0) {
          const timeout = setTimeout(async () => {
            await this.obsController.hideAsset(sceneName, sourceName);
            this.activeTimeouts.delete(timeoutKey);
            this.activeAssets.delete(sourceName);
            this.broadcastMediaStatus(sceneName, sourceName, 'hidden');
          }, duration * 1000);
          
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
        await this.obsController.hideAsset(sceneName, sourceName);
        this.activeAssets.delete(sourceName);
        this.broadcastMediaStatus(sceneName, sourceName, 'hidden');
      } else {
        // Hide all active assets we are tracking
        for (const source of this.activeAssets.keys()) {
          await this.obsController.hideAsset(sceneName, source);
        }

        // Dynamically stop everything in the configured scene
        await this.obsController.stopAllAssets(sceneName);
        
        // Also stop/hide the default configured sources just in case they are in another scene
        await this.obsController.hideAsset(sceneName, defaultVideoSource);
        await this.obsController.hideAsset(sceneName, defaultImageSource);
        
        this.activeAssets.clear();

        this.broadcastMediaStatus(sceneName, defaultVideoSource, 'hidden');
        this.broadcastMediaStatus(sceneName, defaultImageSource, 'hidden');

        // Broadcast general stop to clear all active cards
        this.broadcastAllAssetsStopped();
      }
      ws.send(JSON.stringify({ type: 'success', message: 'All assets stopped and hidden' }));
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

  private broadcastMediaStatus(sceneName: string, sourceName: string, state: 'playing' | 'hidden', assetName?: string) {
    const msg = JSON.stringify({
      type: 'media_state',
      sceneName,
      sourceName,
      state,
      assetName
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

    // 2. Subdirectory checks (videos, gifs, memes, overlays, sounds)
    const dirs = ['videos', 'gifs', 'memes', 'overlays', 'sounds'];
    for (const dir of dirs) {
      fullPath = path.join(this.mediaPath, dir, fileName);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    }

    return null;
  }
}
