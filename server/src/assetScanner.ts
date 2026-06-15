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
}

export class AssetScanner {
  private mediaPath: string;
  private videoExtensions = ['.mp4', '.mkv', '.webm', '.avi', '.mov'];
  private imageExtensions = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
  private audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
  private thumbnailGenerator: ThumbnailGenerator;

  constructor(mediaPath: string) {
    this.mediaPath = mediaPath;
    this.thumbnailGenerator = new ThumbnailGenerator(mediaPath);
  }

  /**
   * Scans the media folder and groups assets by category (subdirectory or "root")
   */
  public scan(): MediaAsset[] {
    const assets: MediaAsset[] = [];
    if (!fs.existsSync(this.mediaPath)) {
      console.warn(`[Scanner] Media path does not exist: ${this.mediaPath}`);
      return [];
    }

    try {
      // 1. Scan root directory
      this.scanDir(this.mediaPath, '', 'General', assets);

      // 2. Scan standard subdirectories
      const subdirs = ['videos', 'gifs', 'memes', 'overlays', 'sounds'];
      for (const subdir of subdirs) {
        const fullSubdirPath = path.join(this.mediaPath, subdir);
        if (fs.existsSync(fullSubdirPath) && fs.statSync(fullSubdirPath).isDirectory()) {
          // Capitalize the subdir name for category display
          const category = subdir.charAt(0).toUpperCase() + subdir.slice(1);
          this.scanDir(fullSubdirPath, subdir, category, assets);
        }
      }
    } catch (err) {
      console.error('[Scanner] Error scanning assets directory:', err);
    }

    return assets;
  }

  private scanDir(dirPath: string, relativePrefix: string, category: string, assets: MediaAsset[]) {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isFile()) {
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
          // Generate a clean id and name
          const cleanName = path.basename(item, ext).replace(/[_-]/g, ' ');
          const id = Buffer.from(relativeFile).toString('base64').replace(/=/g, '');

          // Get or trigger thumbnail generation for images and videos
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
            category
          });
        }
      }
    }
  }
}
