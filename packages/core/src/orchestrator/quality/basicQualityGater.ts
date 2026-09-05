import type { QualityGater, QualityReport } from '../types.js';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

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

    // Cheap variance check over a sample
    const sampleStep = clamp(Math.floor(imageBytes.length / 20_000), 1, 250);
    let count = 0;
    let sum = 0;
    let sumSq = 0;

    for (let i = 0; i < imageBytes.length; i += sampleStep) {
      const v = imageBytes[i]!;
      count++;
      sum += v;
      sumSq += v * v;
    }

    const mean = sum / count;
    const variance = sumSq / count - mean * mean;

    // Heuristic thresholds
    if (variance < 80) notes.push('low_detail_or_overexposed');
    if (variance > 5000) notes.push('noisy_or_compressed');

    let imageQuality: QualityReport['imageQuality'] = 'ok';
    if (notes.includes('very_small_image') || notes.includes('low_detail_or_overexposed')) {
      imageQuality = 'poor';
    } else if (notes.length === 0) {
      imageQuality = 'good';
    }

    return { imageQuality, notes };
  }
}
