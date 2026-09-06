import type { QualityGater, QualityReport } from '../types.js';
import sharp from 'sharp';

/**
 * Very basic gating without heavy CV deps:
 * - checks size
 * - checks "entropy-ish" (roughly: is the image all one color?) using byte variance
 *
 * TODO later: This isn't blur detection; it’s a cheap placeholder until we add OpenCV later.
 */
export class BasicQualityGater implements QualityGater {
  async assess(imageBytes: Buffer): Promise<QualityReport> {
    const notes: string[] = [];

    if (imageBytes.length === 0) {
      return { imageQuality: 'poor', notes: ['empty_image'] };
    }

    if (imageBytes.length < 15_000) notes.push('very_small_image');
    if (imageBytes.length > 8_000_000) notes.push('very_large_image');

    try {
      const pixels = await sharp(imageBytes)
        .rotate()
        .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
        .greyscale()
        .raw()
        .toBuffer();
      let sum = 0;
      let sumSq = 0;
      for (const value of pixels) {
        sum += value;
        sumSq += value * value;
      }
      const mean = sum / pixels.length;
      const deviation = Math.sqrt(Math.max(0, sumSq / pixels.length - mean * mean));
      if (mean < 28) notes.push('image_too_dark');
      if (mean > 245) notes.push('image_overexposed');
      if (deviation < 7) notes.push('low_visual_detail');

      const edges = await sharp(imageBytes)
        .rotate()
        .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
        .greyscale()
        .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
        .raw()
        .toBuffer();
      let edgeSum = 0;
      let edgeSumSq = 0;
      for (const value of edges) {
        edgeSum += value;
        edgeSumSq += value * value;
      }
      const edgeVariance = edgeSumSq / edges.length - (edgeSum / edges.length) ** 2;
      if (edgeVariance < 18) notes.push('image_may_be_blurred');
    } catch {
      notes.push('invalid_image');
    }

    let imageQuality: QualityReport['imageQuality'] = 'ok';
    if (
      notes.some((note) =>
        [
          'very_small_image',
          'image_too_dark',
          'image_overexposed',
          'low_visual_detail',
          'invalid_image',
        ].includes(note),
      )
    ) {
      imageQuality = 'poor';
    } else if (notes.length === 0) {
      imageQuality = 'good';
    }

    return { imageQuality, notes };
  }
}
