import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const filename = process.argv[2];
if (!filename || !fs.existsSync(filename)) throw new Error('Pass an image file to compare');
const apiKey = process.env.GEMINI_API_KEY;
const accessToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!apiKey || !accessToken || !project)
  throw new Error('Gemini key, Google access token and project are required');

const bytes = fs.readFileSync(filename);
const mimeType = path.extname(filename).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
void main();

async function main() {
  const visionStarted = Date.now();
  const visionResponse = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-goog-user-project': project,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: bytes.toString('base64') },
          features: [{ type: 'TEXT_DETECTION' }, { type: 'LABEL_DETECTION', maxResults: 8 }],
        },
      ],
    }),
  });
  if (!visionResponse.ok) throw new Error(`Vision returned ${visionResponse.status}`);
  const vision: any = await visionResponse.json();
  const result = vision.responses?.[0] ?? {};
  const visionLatencyMs = Date.now() - visionStarted;

  const ai = new GoogleGenAI({ apiKey });
  const geminiStarted = Date.now();
  const gemini = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: bytes.toString('base64') } },
          {
            text: 'Describe only what is visibly supported and transcribe any readable text. Keep it to two short sentences.',
          },
        ],
      },
    ],
    config: {
      maxOutputTokens: 180,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  });

  console.log(
    JSON.stringify(
      {
        imageBytes: bytes.length,
        googleVision: {
          latencyMs: visionLatencyMs,
          ocr: result.fullTextAnnotation?.text?.trim() ?? '',
          labels: (result.labelAnnotations ?? []).map((label: any) => ({
            name: label.description,
            confidence: label.score,
          })),
        },
        geminiDirect: {
          latencyMs: Date.now() - geminiStarted,
          answer: gemini.text?.trim(),
          usage: gemini.usageMetadata,
        },
      },
      null,
      2,
    ),
  );
}
