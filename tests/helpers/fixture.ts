import fs from 'node:fs';
import path from 'node:path';

export const FIXTURES_DIR = path.resolve('tests/fixtures/images');
export const EXPECTATIONS_PATH = path.resolve('tests/fixtures/expectations.json');

export type Expectation = {
  intent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help';
  utterance?: string;
  query?: string;
  expectedTextContains?: string[];
  maxLatencyMs?: number;
  maxRecaptureRate?: number; // not used per-case, but handy later
};

export function loadExpectations(): Record<string, Expectation> {
  if (!fs.existsSync(EXPECTATIONS_PATH)) return {};
  return JSON.parse(fs.readFileSync(EXPECTATIONS_PATH, 'utf8'));
}

export function listFixtureImages(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();
}

export function readFixtureImageBytes(filename: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename));
}

export function containsAll(haystack: string, needles: string[]) {
  const h = (haystack ?? '').toLowerCase();
  return needles.every((n) => h.includes(n.toLowerCase()));
}
