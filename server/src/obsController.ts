import OBSWebSocket from 'obs-websocket-js';
import path from 'path';
import fs from 'fs';

export class OBSController {
  private obs: OBSWebSocket;
  private url: string;
  private password?: string;
  private isConnected: boolean = false;
  private reconnectInterval: NodeJS.Timeout | null = null;

  constructor(url: string, password?: string) {
    this.obs = new OBSWebSocket();
    this.url = url;
    this.password = password;

    // Set up event handlers
    this.obs.on('ConnectionClosed', () => {
      console.log('\x1b[31m[OBS] Connection closed. Attempting reconnect...\x1b[0m');
      this.isConnected = false;
      this.startReconnecting();
    });

    this.obs.on('Identified', () => {
      console.log('\x1b[32m[OBS] Successfully identified and connected to OBS!\x1b[0m');
      this.isConnected = true;
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
      }
    });
  }

  public async connect(): Promise<boolean> {
    try {
      console.log(`[OBS] Connecting to OBS at ${this.url}...`);
      await this.obs.connect(this.url, this.password);
      this.isConnected = true;
      return true;
    } catch (error: any) {
      console.error('\x1b[31m[OBS] Connection error:\x1b[0m', error.message || error);
      this.isConnected = false;
      this.startReconnecting();
      return false;
    }
  }

  private startReconnecting() {
    if (this.reconnectInterval) return;
    this.reconnectInterval = setInterval(async () => {
      console.log('[OBS] Retrying connection...');
      const success = await this.connect();
      if (success && this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
      }
    }, 5000);
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      url: this.url
    };
  }

  /**
   * Play an asset (video or image/gif) in OBS
   * @param sceneName Name of the OBS scene
   * @param sourceName Name of the OBS source
   * @param absoluteFilePath Full path to the media file on PC1
   * @param isVideo True if it's a video (ffmpeg_source), false for image_source
   */
  /**
   * Check if a source exists in a scene
   */
  public async sourceExistsInScene(sceneName: string, sourceName: string): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      await this.obs.call('GetSceneItemId', {
        sceneName: sceneName,
        sourceName: sourceName
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  public async playAsset(
    sceneName: string,
    sourceName: string,
    absoluteFilePath: string,
    isVideo: boolean = true
  ): Promise<{ success: boolean; error?: string; warning?: string }> {
    if (!this.isConnected) {
      console.warn('[OBS] Cannot play asset: Not connected to OBS.');
      return { success: false, error: 'No conectado a OBS Studio' };
    }

    try {
      // Normalize path for OBS (requires forward slashes or escaped backslashes)
      const normalizedPath = absoluteFilePath.replace(/\\/g, '/');
      console.log(`[OBS] Setting source "${sourceName}" file to: ${normalizedPath}`);

      // Query input kind to dynamically adjust the inputSettings payload keys
      let inputKind = '';
      try {
        const inputSettingsResult = await this.obs.call('GetInputSettings', {
          inputName: sourceName
        });
        inputKind = inputSettingsResult.inputKind;
      } catch (err: any) {
        console.warn(`[OBS] Failed to retrieve settings/kind for input "${sourceName}":`, err.message || err);
      }

      console.log(`[OBS] Source "${sourceName}" is of kind: "${inputKind}"`);

      let warning: string | undefined;

      // 1. Update the source file setting based on the actual inputKind (fallback to isVideo check if unknown)
      if (inputKind === 'browser_source') {
        console.log(`[OBS] Source "${sourceName}" is a Browser Source. Skipping file settings update (WebSocket will handle rendering).`);
      } else if (inputKind === 'ffmpeg_source') {
        await this.obs.call('SetInputSettings', {
          inputName: sourceName,
          inputSettings: {
            local_file: normalizedPath,
            looping: false,
            restart_on_active: true
          }
        });
        if (!isVideo) {
          warning = `La imagen "${path.basename(normalizedPath)}" se envió a la fuente multimedia "${sourceName}". Las fuentes de tipo "Multimedia" (ffmpeg_source) en OBS no admiten imágenes estáticas (.webp, .png, .jpg) o pueden no mostrar GIFs. Agrega una fuente de Imagen llamada "GIF_Overlay" en OBS o usa una fuente de Navegador.`;
          console.warn(`[OBS] ${warning}`);
        }
      } else if (inputKind === 'image_source') {
        await this.obs.call('SetInputSettings', {
          inputName: sourceName,
          inputSettings: {
            file: normalizedPath,
            unload: true
          }
        });
      } else {
        // Fallback to legacy logic if kind is unknown/cannot be queried
        if (isVideo) {
          await this.obs.call('SetInputSettings', {
            inputName: sourceName,
            inputSettings: {
              local_file: normalizedPath,
              looping: false,
              restart_on_active: true
            }
          });
        } else {
          await this.obs.call('SetInputSettings', {
            inputName: sourceName,
            inputSettings: {
              file: normalizedPath,
              unload: true
            }
          });
        }
      }

      // 2. Get the scene item ID to manage visibility
      let sceneItemId: number;
      try {
        const idResult = await this.obs.call('GetSceneItemId', {
          sceneName: sceneName,
          sourceName: sourceName
        });
        sceneItemId = idResult.sceneItemId;
      } catch (err) {
        const typeSuggestion = isVideo ? 'Multimedia (ffmpeg_source)' : 'Imagen (image_source)';
        const errorMsg = `La fuente "${sourceName}" no existe en la escena "${sceneName}". Por favor, agrega una fuente de tipo "${typeSuggestion}" llamada "${sourceName}" en tu OBS.`;
        console.error(`[OBS] ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      // 3. Enable visibility (show source)
      await this.obs.call('SetSceneItemEnabled', {
        sceneName: sceneName,
        sceneItemId: sceneItemId,
        sceneItemEnabled: true
      });

      // Get OBS video settings to determine canvas size for centering
      let baseWidth = 720;
      let baseHeight = 1280;
      try {
        const videoSettings = await this.obs.call('GetVideoSettings');
        baseWidth = videoSettings.baseWidth;
        baseHeight = videoSettings.baseHeight;
      } catch (err: any) {
        console.warn(`[OBS] Failed to retrieve video settings (defaulting to 720x1280):`, err.message || err);
      }

      // Center the source item on the screen
      try {
        await this.obs.call('SetSceneItemTransform', {
          sceneName: sceneName,
          sceneItemId: sceneItemId,
          sceneItemTransform: {
            alignment: 0, // Center
            positionX: baseWidth / 2,
            positionY: baseHeight / 2
          }
        });
      } catch (err: any) {
        console.warn(`[OBS] Failed to set scene item transform for centering:`, err.message || err);
      }

      // 4. If it's a video or a media source, restart playback
      if ((isVideo || inputKind === 'ffmpeg_source') && inputKind !== 'browser_source') {
        try {
          await this.obs.call('TriggerMediaInputAction', {
            inputName: sourceName,
            mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
          });
        } catch (e) {
          // Ignore if the source type does not support it (e.g. image source)
        }
      }

      console.log(`\x1b[32m[OBS] Successfully triggered "${sourceName}" in scene "${sceneName}"\x1b[0m`);
      return { success: true, warning };
    } catch (error: any) {
      console.error('[OBS] Error playing asset:', error.message || error);
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Hide a source in OBS
   */
  public async hideAsset(sceneName: string, sourceName: string): Promise<boolean> {
    if (!this.isConnected) return false;

    try {
      // Try to stop media playback if it's a media source (silent fail if it's an image/gif source)
      try {
        await this.obs.call('TriggerMediaInputAction', {
          inputName: sourceName,
          mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
        });
      } catch (e) {
        // Ignore errors for non-media inputs
      }

      // Check if source exists in the scene first to avoid throwing general error
      let sceneItemId: number;
      try {
        const idResult = await this.obs.call('GetSceneItemId', {
          sceneName: sceneName,
          sourceName: sourceName
        });
        sceneItemId = idResult.sceneItemId;
      } catch (err) {
        console.log(`[OBS] Source "${sourceName}" is not in Scene "${sceneName}" (cannot hide)`);
        return false;
      }

      await this.obs.call('SetSceneItemEnabled', {
        sceneName: sceneName,
        sceneItemId: sceneItemId,
        sceneItemEnabled: false
      });

      console.log(`[OBS] Hid and stopped source "${sourceName}" in scene "${sceneName}"`);
      return true;
    } catch (error: any) {
      console.error('[OBS] Error hiding asset:', error.message || error);
      return false;
    }
  }

  /**
   * Stop and hide all sources in the current active scene (or a specific scene)
   */
  public async stopAllAssets(sceneName?: string): Promise<boolean> {
    if (!this.isConnected) return false;

    try {
      let targetScene = sceneName;
      if (!targetScene) {
        const sceneList = await this.obs.call('GetSceneList');
        targetScene = sceneList.currentProgramSceneName;
      }

      console.log(`[OBS] Stopping and hiding all assets in scene "${targetScene}"`);

      const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName: targetScene });

      for (const item of (sceneItems as any[])) {
        const sourceName = item.sourceName as string;
        const itemId = item.sceneItemId as number;

        // Try to stop media if it's a media input
        try {
          await this.obs.call('TriggerMediaInputAction', {
            inputName: sourceName,
            mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
          });
        } catch (e) {
          // Ignore if it's not a media input
        }

        // Hide the item only if it is an overlay, trigger, or matches default source names
        const lowerName = sourceName.toLowerCase();
        const isOverlayOrTrigger = lowerName.includes('overlay') || 
                                   lowerName.includes('trigger') || 
                                   sourceName === 'Overlay_Main' || 
                                   sourceName === 'GIF_Overlay';

        if (isOverlayOrTrigger) {
          try {
            await this.obs.call('SetSceneItemEnabled', {
              sceneName: targetScene,
              sceneItemId: itemId,
              sceneItemEnabled: false
            });
          } catch (e) {
            // Ignore
          }
        }
      }

      return true;
    } catch (error: any) {
      console.error('[OBS] Error stopping all assets:', error.message || error);
      return false;
    }
  }

  /**
   * Get the name of the currently active program scene in OBS
   */
  public async getCurrentSceneName(): Promise<string> {
    if (!this.isConnected) return 'FUNNY_OVERLAYS';
    try {
      const sceneList = await this.obs.call('GetSceneList');
      return sceneList.currentProgramSceneName;
    } catch (err: any) {
      console.warn('[OBS] Failed to get current program scene name:', err.message || err);
      return 'FUNNY_OVERLAYS'; // fallback
    }
  }

  /**
   * For testing connection, retrieves OBS system info
   */
  public async getVersionInfo() {
    if (!this.isConnected) return null;
    return await this.obs.call('GetVersion');
  }
}
