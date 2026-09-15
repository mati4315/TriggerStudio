import fs from 'fs';
import path from 'path';
import { ThumbnailGenerator } from './thumbnailGenerator';

export interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  file: string; // Relative to MEDIA_PATH
  thumbnail?: string;
  category: string;
  folder: string; // e.g. "videos", "videos/cumple", etc.
}

export class AssetScanner {
  private mediaPath: string;
  private videoExtensions = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'];
  private imageExtensions = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];
  private audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
  private thumbnailGenerator: ThumbnailGenerator;

  constructor(mediaPath: string) {
    this.mediaPath = mediaPath;
    this.thumbnailGenerator = new ThumbnailGenerator(mediaPath);
  }

  /**
   * Scans the media folder recursively and groups assets by category and folder
   */
  public scan(): MediaAsset[] {
    const assets: MediaAsset[] = [];
    if (!fs.existsSync(this.mediaPath)) {
      console.warn(`[Scanner] Media path does not exist: ${this.mediaPath}`);
      return [];
    }

    try {
      this.scanRecursive(this.mediaPath, '', assets);
    } catch (err) {
      console.error('[Scanner] Error scanning assets directory:', err);
    }

    return assets;
  }

  private scanRecursive(currentDir: string, relativePrefix: string, assets: MediaAsset[]) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      if (item === '.thumbnails' || item.startsWith('.')) continue;

      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const nextRelative = relativePrefix ? `${relativePrefix}/${item}` : item;
        this.scanRecursive(fullPath, nextRelative, assets);
      } else if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();
        let type: 'video' | 'image' | 'audio' | null = null;

        if (this.videoExtensions.includes(ext)) {
          type = 'video';
        } else if (this.imageExtensions.includes(ext)) {
          type = 'image';
        } else if (this.audioExtensions.includes(ext)) {
          type = 'audio';
        }

        if (type) {
          const relativeFile = relativePrefix ? path.join(relativePrefix, item) : item;
          const cleanName = path.basename(item, ext).replace(/[_-]/g, ' ');
          const id = Buffer.from(relativeFile.replace(/\\/g, '/')).toString('base64').replace(/=/g, '');

          // Determine category (top-level directory or General)
          let category = 'General';
          let folder = relativePrefix ? relativePrefix.replace(/\\/g, '/') : 'general';
          
          if (relativePrefix) {
            const rootPart = relativePrefix.split(/[\\/]/)[0];
            category = rootPart.charAt(0).toUpperCase() + rootPart.slice(1);
          }

          let thumbnail: string | undefined = undefined;
          if (type === 'video' || type === 'image') {
            thumbnail = this.thumbnailGenerator.getOrGenerate(fullPath, id, type);
          }

          assets.push({
            id,
            name: cleanName,
            type,
            file: relativeFile.replace(/\\/g, '/'),
            thumbnail,
            category,
            folder
          });
        }
      }
    }
  }
}
