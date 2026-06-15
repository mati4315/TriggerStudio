import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Initialize ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export class ThumbnailGenerator {
  private mediaPath: string;
  private thumbnailsDir: string;
  private generatingTasks: Set<string> = new Set();

  constructor(mediaPath: string) {
    this.mediaPath = mediaPath;
    this.thumbnailsDir = path.join(mediaPath, '.thumbnails');
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists() {
    if (!fs.existsSync(this.thumbnailsDir)) {
      try {
        fs.mkdirSync(this.thumbnailsDir, { recursive: true });
        console.log(`[Thumbnail] Created thumbnails directory at: ${this.thumbnailsDir}`);
      } catch (err) {
        console.error(`[Thumbnail] Error creating thumbnails directory:`, err);
      }
    }
  }

  /**
   * Gets the thumbnail URL if it exists, otherwise triggers background generation.
   * Returns undefined if the thumbnail is not ready yet.
   */
  public getOrGenerate(filePath: string, id: string, type: 'video' | 'image'): string | undefined {
    const ext = path.extname(filePath).toLowerCase();

    // For static images (excluding gifs), use the image itself as the thumbnail
    if (type === 'image' && ext !== '.gif') {
      const relativePath = path.relative(this.mediaPath, filePath).replace(/\\/g, '/');
      return `/media/${relativePath}`;
    }

    // For videos and gifs, we generate a thumbnail
    const thumbFileName = `${id}.jpg`;
    const thumbFilePath = path.join(this.thumbnailsDir, thumbFileName);

    if (fs.existsSync(thumbFilePath)) {
      return `/media/.thumbnails/${thumbFileName}`;
    }

    // Trigger generation if not already in progress
    if (!this.generatingTasks.has(id)) {
      this.generatingTasks.add(id);
      this.generate(filePath, thumbFilePath, id);
    }

    return undefined;
  }

  private generate(filePath: string, destPath: string, id: string) {
    const ext = path.extname(filePath).toLowerCase();
    const isGif = ext === '.gif';

    // Use 0.5s for videos to avoid initial black frames, 0s for GIFs
    const timestamp = isGif ? 0 : 0.5;

    ffmpeg(filePath)
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(destPath),
        folder: this.thumbnailsDir,
        size: '320x?'
      })
      .on('end', () => {
        this.generatingTasks.delete(id);
        console.log(`[Thumbnail] Generated thumbnail for: ${path.basename(filePath)}`);
      })
      .on('error', (err: any) => {
        this.generatingTasks.delete(id);
        console.error(`[Thumbnail] Failed to generate thumbnail for ${path.basename(filePath)}:`, err.message);
      });
  }
}
