import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import inquirer from 'inquirer';
import sharp from 'sharp';

import type { UserRequest, PerceptionResult, AssistantReply, MemoryItem } from '@frank/contracts';
import { PerceptionResultSchema } from '@frank/contracts';

import { FrankOrchestrator } from '@frank/core';
import { makeMemoryApiStore } from './memoryApiStore.js';
import { GcvVisionProvider, GeminiLlmProvider } from '@frank/providers';

// If these aren’t exported nicely yet, adjust import paths.
// Recommended: export these from @frank/core instead of dist paths.
import { BasicPolicyEngine } from '@frank/core/dist/orchestrator/policy/basicPolicyEngine.js';
import { BasicQualityGater } from '@frank/core/dist/orchestrator/quality/basicQualityGater.js';

const FIXTURES_DIR = path.resolve('tests/fixtures/images');

const memory = makeMemoryApiStore();

function listImages(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();
}

function readImageBytes(filename: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename));
}

function makeRequest(args: {
  sessionId: string;
  intent: UserRequest['intent'];
  utterance?: string;
  query?: string;
}): UserRequest {
  return {
    trace: { requestId: crypto.randomUUID(), sessionId: args.sessionId },
    intent: args.intent,
    modality: 'app',
    utterance: args.utterance,
    hasImage: true,
    query: args.query,
    requestedAt: new Date().toISOString(),
  } as any;
}

function printSection(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

function printPerception(perception: PerceptionResult) {
  const ocr = perception.ocr?.fullText?.trim() ?? '';
  const labels = (perception.labels ?? []).slice(0, 10);

  printSection('VISION OUTPUT');
  console.log(
    `quality: ${perception.imageQuality} | notes: ${(perception.imageQualityNotes ?? []).join(', ') || '-'}`,
  );
  console.log(
    `labels: ${labels.map((l) => `${l.name}${l.confidence != null ? `(${l.confidence.toFixed(2)})` : ''}`).join(', ') || '-'}`,
  );

  printSection('OCR TEXT');
  if (!ocr) {
    console.log('(none)');
  } else {
    // show first ~1200 chars so console doesn't explode
    const max = 1200;
    console.log(ocr.length > max ? ocr.slice(0, max) + '\n...[truncated]' : ocr);
  }
}

function printReply(reply: AssistantReply, latencyMs: number) {
  printSection('FRANK REPLY');
  console.log(`latency: ${latencyMs}ms`);
  console.log(`action: ${reply.suggestedAction ?? 'none'}`);
  console.log(`groundedIn:`, reply.groundedIn);
  console.log('\n' + reply.speak);
}

async function normalizeImage(imageBytes: Buffer) {
  return await sharp(imageBytes)
    .rotate() // respect EXIF orientation
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function main() {
  const images = listImages();
  if (images.length === 0) {
    console.error(`No images found in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const sessionId = crypto.randomUUID();

  const vision = new GcvVisionProvider();
  const llm = new GeminiLlmProvider({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });

  // NOTE: This orchestrator already calls vision+llm internally,
  // but we ALSO want the ability to preview perception before calling LLM.
  const frank = new FrankOrchestrator({
    vision,
    llm,
    memory,
    policy: new BasicPolicyEngine(),
    quality: new BasicQualityGater(),
  } as any);

  let lastImage: string | null = null;

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Frank console: what do you want to do?',
        choices: [
          { name: 'Pick image', value: 'pick' },
          { name: 'Analyze (run full Frank pipeline)', value: 'analyze' },
          { name: 'Preview vision only (OCR + labels)', value: 'vision' },
          { name: 'Recall (search memory)', value: 'recall' },
          { name: 'Show memory (recent)', value: 'mem' },
          { name: 'Exit', value: 'exit' },
        ],
      },
    ]);

    if (action === 'exit') break;

    if (action === 'pick') {
      const { picked } = await inquirer.prompt([
        { type: 'list', name: 'picked', message: 'Select an image', choices: images },
      ]);
      lastImage = picked;
      console.log(`Selected: ${lastImage}`);
      continue;
    }

    if (!lastImage && (action === 'analyze' || action === 'vision')) {
      console.log('Pick an image first.');
      continue;
    }

    if (action === 'vision') {
      //TODO: Confirm normalizeImage is worth it.
      const imageBytes = await normalizeImage(readImageBytes(lastImage!));
      const now = new Date().toISOString();
      const trace = { requestId: crypto.randomUUID(), sessionId };

      const [ocrRes, labelsRes] = await Promise.all([
        vision.analyzeOCR({ trace, imageBytes, capturedAt: now }),
        vision.analyzeLabels({ trace, imageBytes, capturedAt: now }),
      ]);

      const perception = PerceptionResultSchema.parse({
        trace,
        provider: 'gcv',
        capturedAt: now,
        imageQuality: 'ok',
        imageQualityNotes: [],
        ocr: ocrRes.ocr,
        labels: labelsRes.labels ?? [],
      });

      printPerception(perception);
      continue;
    }

    if (action === 'recall') {
      const { query } = await inquirer.prompt([
        { type: 'input', name: 'query', message: 'Search memory for:' },
      ]);
      // const trace = { requestId: crypto.randomUUID(), sessionId };
      const result = await memory.search(query, 10);

      printSection(`MEMORY HITS (${result.length})`);
      for (const h of result) {
        console.log(`- ${h.title} | ${h.createdAt}`);
        console.log(`  ${h.content.slice(0, 140)}${h.content.length > 140 ? '...' : ''}`);
      }
      continue;
    }

    if (action === 'mem') {
      const recent = await memory.recent(10);

      printSection(`MEMORY RECENT (${recent.length})`);
      for (const h of recent) {
        console.log(`- ${h.title} | ${h.createdAt}`);
        console.log(`  ${h.content.slice(0, 140)}${h.content.length > 140 ? '...' : ''}`);
      }
      continue;
    }

    if (action === 'analyze') {
      const { intent, utterance } = await inquirer.prompt([
        {
          type: 'list',
          name: 'intent',
          message: 'Intent?',
          choices: [
            { name: 'read_text', value: 'read_text' },
            { name: 'describe_scene', value: 'describe_scene' },
            { name: 'remember_this', value: 'remember_this' },
            { name: 'recall', value: 'recall' },
            { name: 'help', value: 'help' },
          ],
        },
        {
          type: 'input',
          name: 'utterance',
          message: 'Voice prompt (what user said):',
          default: 'Read this.',
        },
      ]);

      const imageBytes = readImageBytes(lastImage!);
      const req = makeRequest({ sessionId, intent, utterance });

      const start = performance.now();
      const reply = await frank.handleUserRequest(req, imageBytes);
      const latencyMs = Math.round(performance.now() - start);

      // Show result clearly
      printReply(reply, latencyMs);

      //TODO: Why have we never been asked to recapture?
      // If recapture recommended, let us immediately try another image as next attempt.
      if (reply.suggestedAction === 'recapture') {
        const { doRecapture } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'doRecapture',
            message: 'Recapture suggested. Pick another image as recapture attempt?',
            default: true,
          },
        ]);

        if (doRecapture) {
          const { nextImg } = await inquirer.prompt([
            { type: 'list', name: 'nextImg', message: 'Select recapture image', choices: images },
          ]);
          lastImage = nextImg;
          console.log(`Recapture image selected: ${lastImage}`);
        }
      }

      continue;
    }
  }

  console.log('Bye.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
