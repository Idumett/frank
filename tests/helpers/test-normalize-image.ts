import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

async function normalizeImage(imageBytes: Buffer) {
  return await sharp(imageBytes)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function main() {
  const inPath = process.argv[2];
  if (!inPath) {
    console.error('Usage: pnpm tsx scripts/test-normalize-image.ts <input-image>');
    process.exit(1);
  }

  const input = await fs.readFile(inPath);

  const beforeMeta = await sharp(input).metadata();
  const out = await normalizeImage(input);
  const afterMeta = await sharp(out).metadata();

  const outPath = path.join(
    path.dirname(inPath),
    path.basename(inPath, path.extname(inPath)) + '.normalized.jpg',
  );

  await fs.writeFile(outPath, out);

  console.log('Input:', inPath);
  console.log('Output:', outPath);
  console.log('Bytes:', { before: input.length, after: out.length });
  console.log('Meta before:', beforeMeta);
  console.log('Meta after:', afterMeta);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
