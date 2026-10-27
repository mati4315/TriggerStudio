import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import path from 'path';
import fs from 'fs';
import { OBSController } from './obsController';

interface ClientMessage {
  action: 'play' | 'stop' | 'hide' | 'status' | 'ended' | 'volume' | 'mute' | 'playback' | 'seek' | 'progress';
  video?: string;      // Simple format
  asset?: string;      // Structured format
  type?: 'video' | 'image' | 'audio';
  category?: string;   // Category of the asset
  duration?: number;   // Auto-hide duration in seconds
  sceneName?: string;
  sourceName?: string;
  mute?: boolean;
  volume?: number;
  playback?: 'play' | 'pause';
  currentTime?: number;
  paused?: boolean;
}

export class TriggerWebSocketServer {
  private wss: WebSocketServer;
  private obsController: OBSController;
  private mediaPath: string;
  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private playbackQueue: Promise<void> = Promise.resolve();
  private browserSourceVolumes: Map<string, number> = new Map();
  private activeAssets: Map<string, { asset: string; type: 'video' | 'image' | 'audio'; startedAt: number; category?: string; mute?: boolean; volume?: number; inputKind?: string; currentTime?: number; duration?: number; paused?: boolean }> = new Map();

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
          if (data.action !== 'progress') console.log('[WS] Received message:', data);
          if (data.action === 'play' || data.action === 'stop' || data.action === 'hide') {
            const queuedPlay = this.playbackQueue.then(() => this.handleMessage(ws, data));
            this.playbackQueue = queuedPlay.catch(() => undefined);
            await queuedPlay;
          } else {
            await this.handleMessage(ws, data);
          }
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
      const endedAsset = this.activeAssets.get(inputName);
      if (!endedAsset) return;

      const activeScene = await this.obsController.getCurrentSceneName();
      const sceneName = process.env.OBS_SCENE || activeScene;
      
      this.activeAssets.delete(inputName);
      this.broadcastMediaStatus(sceneName, inputName, 'hidden', endedAsset.asset);
      
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
    setInterval(() => {
      void this.broadcastPlaybackProgress();
    }, 750);
  }

  public setMediaPath(mediaPath: string) {
    this.mediaPath = mediaPath;
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
    const defaultVideoSource = process.env.OBS_SOURCE_VIDEO || 'Overlay_Main';
    const defaultImageSource = process.env.OBS_SOURCE_IMAGE || 'GIF_Overlay';
    const defaultAudioSource = process.env.OBS_SOURCE_AUDIO || 'Sound_Effect';

    if (msg.action === 'status') {
      this.sendConnectionStatus(ws);
      return;
    }

    if (msg.action === 'progress') {
      const sourceName = msg.sourceName;
      const activeAsset = sourceName ? this.activeAssets.get(sourceName) : undefined;
      if (!sourceName || !activeAsset || (activeAsset.type !== 'video' && activeAsset.type !== 'audio')) return;
      if (msg.asset && msg.asset !== activeAsset.asset) return;
      const currentTime = Number(msg.currentTime);
      const duration = Number(msg.duration);
      if (!Number.isFinite(currentTime) || currentTime < 0) return;
      activeAsset.currentTime = currentTime;
      activeAsset.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      activeAsset.paused = !!msg.paused;
      this.sendPlayerProgress(sourceName, activeAsset.asset, activeAsset.currentTime, activeAsset.duration, activeAsset.paused);
      return;
    }

    const activeScene = await this.obsController.getCurrentSceneName();
    const sceneName = msg.sceneName || process.env.OBS_SCENE || activeScene;

    if (msg.action === 'ended') {
      const sourceName = msg.sourceName || defaultVideoSource;
      console.log(`[WS] Client reported media ended on source: ${sourceName}`);
      const endedAsset = this.activeAssets.get(sourceName);
      if (endedAsset) {
        this.activeAssets.delete(sourceName);
        this.broadcastMediaStatus(sceneName, sourceName, 'hidden', endedAsset.asset);
      }
      return;
    }

    if (msg.action === 'mute') {
      const sourceName = msg.sourceName;
      const activeAsset = sourceName ? this.activeAssets.get(sourceName) : undefined;
      if (!sourceName || !activeAsset) {
        ws.send(JSON.stringify({ type: 'error', message: 'No hay un medio activo para cambiar el silencio.' }));
        return;
      }
      const muted = !!msg.mute;
      try {
        await this.obsController.setInputMute(sourceName, muted);
        activeAsset.mute = muted;
        this.broadcastPlayerControl({ action: 'mute', sourceName, muted });
        this.broadcastPlayerState(sourceName, activeAsset);
      } catch (error: any) {
        ws.send(JSON.stringify({ type: 'error', message: `No se pudo cambiar el silencio: ${error.message || error}` }));
      }
      return;
    }

    if (msg.action === 'playback') {
      const sourceName = msg.sourceName;
      const activeAsset = sourceName ? this.activeAssets.get(sourceName) : undefined;
      if (!sourceName || !activeAsset || (activeAsset.type !== 'video' && activeAsset.type !== 'audio')) {
        ws.send(JSON.stringify({ type: 'error', message: 'No hay un video o audio activo para controlar.' }));
        return;
      }
      if (msg.playback !== 'play' && msg.playback !== 'pause') {
        ws.send(JSON.stringify({ type: 'error', message: 'Acción de reproducción no válida.' }));
        return;
      }
      try {
        const paused = msg.playback === 'pause';
        this.broadcastPlayerControl({ action: msg.playback, sourceName });
        if (activeAsset.inputKind && activeAsset.inputKind !== 'browser_source') {
          await this.obsController.setMediaInputPlayback(sourceName, msg.playback);
        }
        activeAsset.paused = paused;
        this.broadcastPlayerState(sourceName, activeAsset);
      } catch (error: any) {
        ws.send(JSON.stringify({ type: 'error', message: `No se pudo ${msg.playback === 'pause' ? 'pausar' : 'reanudar'} el medio: ${error.message || error}` }));
      }
      return;
    }

    if (msg.action === 'seek') {
      const sourceName = msg.sourceName;
      const activeAsset = sourceName ? this.activeAssets.get(sourceName) : undefined;
      const position = Number(msg.currentTime);
      if (!sourceName || !activeAsset || (activeAsset.type !== 'video' && activeAsset.type !== 'audio')) {
        ws.send(JSON.stringify({ type: 'error', message: 'No hay un video o audio activo para adelantar o retroceder.' }));
        return;
      }
      if (!Number.isFinite(position) || position < 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'La posición indicada no es válida.' }));
        return;
      }
      try {
        this.broadcastPlayerControl({ action: 'seek', sourceName, currentTime: position });
        if (activeAsset.inputKind && activeAsset.inputKind !== 'browser_source') {
          await this.obsController.seekMediaInput(sourceName, position);
        }
        activeAsset.currentTime = position;
        this.broadcastPlayerProgress(sourceName, activeAsset);
      } catch (error: any) {
        ws.send(JSON.stringify({ type: 'error', message: `No se pudo cambiar la posición del medio: ${error.message || error}` }));
      }
      return;
    }

    if (msg.action === 'volume') {
      const sourceName = msg.sourceName;
      const activeAsset = sourceName ? this.activeAssets.get(sourceName) : undefined;
      if (!sourceName || !activeAsset) {
        ws.send(JSON.stringify({ type: 'error', message: 'No hay un medio activo para cambiar su volumen.' }));
        return;
      }
      const volume = Number(msg.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 200) {
        ws.send(JSON.stringify({ type: 'error', message: 'El volumen debe estar entre 0 y 200%.' }));
        return;
      }
      try {
        let appliedVolume = Math.round(volume);
        if (activeAsset.inputKind === 'browser_source') {
          // Browser Source audio may bypass OBS's mixer and be played directly by
          // the overlay's HTML media element.
          this.browserSourceVolumes.set(sourceName, appliedVolume);
        } else {
          await this.obsController.setInputVolume(sourceName, volume / 100);
          appliedVolume = Math.round((await this.obsController.getInputVolume(sourceName)) * 100);
        }
        activeAsset.volume = appliedVolume;
        console.log(`[OBS] Volume for "${sourceName}" set to ${appliedVolume}%`);
        this.broadcastPlayerControl({ action: 'volume', sourceName, volume: appliedVolume });
        this.broadcastVolume(sourceName, appliedVolume);
      } catch (error: any) {
        ws.send(JSON.stringify({ type: 'error', message: `No se pudo cambiar el volumen: ${error.message || error}` }));
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

      // Keep one item playing at a time, including across different OBS sources.
      for (const timeout of this.activeTimeouts.values()) clearTimeout(timeout);
      this.activeTimeouts.clear();
      const previousAssets = Array.from(this.activeAssets.entries());
      this.activeAssets.clear();
      for (const [previousSource, previousAsset] of previousAssets) {
        if (previousAsset.inputKind === 'image_source') {
          await this.obsController.hideAsset(sceneName, previousSource, true);
        } else {
          await this.obsController.stopAsset(previousSource);
        }
        this.broadcastMediaStatus(sceneName, previousSource, 'hidden', previousAsset.asset);
      }
      for (const configuredSource of new Set([defaultVideoSource, defaultImageSource, defaultAudioSource])) {
        await this.obsController.stopAsset(configuredSource);
      }
      // Close the old overlay item before the next media_state:playing arrives.
      this.broadcastAllAssetsStopped('replace');

      // Cancel any lingering timeout for this source.
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
        let currentVolume = result.inputKind === 'browser_source'
          ? (this.browserSourceVolumes.get(sourceName) ?? 100)
          : 100;
        if (result.inputKind !== 'browser_source') {
          try {
            currentVolume = Math.round((await this.obsController.getInputVolume(sourceName)) * 100);
          } catch (error: any) {
            console.warn(`[OBS] Could not read volume for "${sourceName}":`, error.message || error);
          }
        }
        this.activeAssets.set(sourceName, {
          asset: fileName,
          type: isAudio ? 'audio' : (isVideo ? 'video' : 'image'),
          category: msg.category,
          startedAt: Date.now(),
          mute: mute,
          volume: currentVolume,
          inputKind: result.inputKind,
          currentTime: 0,
          duration: 0,
          paused: false
        });

        // Broadcast that it is playing
        this.broadcastMediaStatus(sceneName, sourceName, 'playing', fileName, msg.category, mute, currentVolume);

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
          const playbackStartedAt = this.activeAssets.get(sourceName)?.startedAt;
          const timeout = setTimeout(async () => {
            if (this.activeAssets.get(sourceName)?.startedAt !== playbackStartedAt) return;
            console.log(`[Auto-Finish] Duration reached (${effectiveDuration}s) for "${fileName}". Auto-stopping...`);
            this.activeTimeouts.delete(timeoutKey);
            this.activeAssets.delete(sourceName);
            await this.obsController.stopAsset(sourceName);
            this.broadcastMediaStatus(sceneName, sourceName, 'hidden', fileName);
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
        const stoppedAsset = this.activeAssets.get(sourceName);
        this.activeAssets.delete(sourceName);
        await this.obsController.stopAsset(sourceName);
        this.broadcastMediaStatus(sceneName, sourceName, 'hidden', stoppedAsset?.asset);
      } else {
        // Emergency stop: stop all media in the scene without disabling any source
        const stoppedAssets = Array.from(this.activeAssets.entries());
        this.activeAssets.clear();
        await this.obsController.stopAllAssets(sceneName);
        
        // Also stop default configured sources
        await this.obsController.stopAsset(defaultVideoSource);
        await this.obsController.stopAsset(defaultImageSource);
        
        for (const [activeSource, activeAsset] of stoppedAssets) {
          this.broadcastMediaStatus(sceneName, activeSource, 'hidden', activeAsset.asset);
        }
        this.broadcastMediaStatus(sceneName, defaultVideoSource, 'hidden');
        this.broadcastMediaStatus(sceneName, defaultImageSource, 'hidden');

        // Broadcast general stop to clear all active cards and stop overlay
        this.broadcastAllAssetsStopped();
      }
      ws.send(JSON.stringify({ type: 'success', message: 'All playback stopped' }));
      return;
    }
  }

  private broadcastAllAssetsStopped(reason: 'replace' | 'stop' = 'stop') {
    const msg = JSON.stringify({
      type: 'all_stopped',
      reason
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  private broadcastVolume(sourceName: string, volume: number) {
    const msg = JSON.stringify({ type: 'volume', sourceName, volume });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  private broadcastPlayerControl(control: { action: 'play' | 'pause' | 'seek' | 'mute' | 'volume'; sourceName: string; currentTime?: number; muted?: boolean; volume?: number }) {
    const message = JSON.stringify({ type: 'player_control', ...control });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  private broadcastPlaybackProgress() {
    this.activeAssets.forEach((activeAsset, sourceName) => {
      if (activeAsset.inputKind && activeAsset.inputKind !== 'browser_source') {
        this.broadcastPlayerProgress(sourceName, activeAsset);
      }
    });
  }

  private broadcastPlayerState(sourceName: string, activeAsset: { asset: string; mute?: boolean; paused?: boolean; currentTime?: number; duration?: number }) {
    const message = JSON.stringify({
      type: 'player_state',
      sourceName,
      assetName: activeAsset.asset,
      mute: activeAsset.mute,
      paused: activeAsset.paused,
      currentTime: activeAsset.currentTime || 0,
      duration: activeAsset.duration || 0
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  private broadcastPlayerProgress(sourceName: string, activeAsset: { asset: string; type: 'video' | 'image' | 'audio'; inputKind?: string; currentTime?: number; duration?: number; paused?: boolean }) {
    if (activeAsset.type !== 'video' && activeAsset.type !== 'audio') return;
    if (activeAsset.inputKind && activeAsset.inputKind !== 'browser_source') {
      void this.obsController.getMediaInputStatus(sourceName).then((status) => {
        const currentTime = Math.max(0, (Number(status.mediaCursor) || 0) / 1000);
        const duration = Math.max(0, (Number(status.mediaDuration) || 0) / 1000);
        if (duration <= 0) return;
        const paused = status.mediaState === 'OBS_MEDIA_STATE_PAUSED';
        activeAsset.currentTime = currentTime;
        activeAsset.duration = duration;
        activeAsset.paused = paused;
        this.sendPlayerProgress(sourceName, activeAsset.asset, currentTime, duration, paused);
      }).catch(() => undefined);
      return;
    }
    this.sendPlayerProgress(sourceName, activeAsset.asset, activeAsset.currentTime || 0, activeAsset.duration || 0, !!activeAsset.paused);
  }

  private sendPlayerProgress(sourceName: string, assetName: string, currentTime: number, duration: number, paused: boolean) {
    const message = JSON.stringify({ type: 'player_progress', sourceName, assetName, currentTime, duration, paused });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  private broadcastMediaStatus(sceneName: string, sourceName: string, state: 'playing' | 'hidden', assetName?: string, category?: string, mute?: boolean, volume?: number) {
    const msg = JSON.stringify({
      type: 'media_state',
      sceneName,
      sourceName,
      state,
      assetName,
      assetType: this.activeAssets.get(sourceName)?.type,
      inputKind: this.activeAssets.get(sourceName)?.inputKind,
      category,
      mute,
      volume
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
