require('dotenv').config();
const WebSocket = require('ws');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const { Porcupine, BuiltinKeyword } = require('@picovoice/porcupine-node');
const { Cobra } = require('@picovoice/cobra-node');
const { PvRecorder } = require('@picovoice/pvrecorder-node');

const WS_URL =
  process.env.FRANK_WS_URL || 'wss://irrigative-posttoxic-annie.ngrok-free.dev/v1/device/stream';
const DEVICE_ID = process.env.DEVICE_ID || 'frank-rpi-01';
const SPEAKER_DEVICE = process.env.SPEAKER_DEVICE || 'plughw:1,0';

const ACCESS_KEY = process.env.PICOVOICE_ACCESS_KEY;
const MIC_DEVICE_INDEX = Number(process.env.MIC_DEVICE_INDEX || '-1');
const PORCUPINE_SENSITIVITY = Number(process.env.PORCUPINE_SENSITIVITY || '0.65');
const WAKEWORD_PATH = process.env.PORCUPINE_WAKEWORD_PATH || '';

const SAMPLE_RATE = 16000;
const END_SILENCE_MS = 1200;
const MAX_RECORDING_MS = 10000;
const START_SPEECH_PROB = 0.55;
const END_SPEECH_PROB = 0.3;

const BEEP_START_PATH = process.env.BEEP_START_PATH || '/home/frank/beep_start.wav';
const BEEP_STOP_PATH = process.env.BEEP_STOP_PATH || '/home/frank/beep_stop.wav';

if (!WS_URL) {
  console.error('Missing FRANK_WS_URL');
  process.exit(1);
}

if (!ACCESS_KEY) {
  console.error('Missing PICOVOICE_ACCESS_KEY');
  process.exit(1);
}

let ws = null;
let player = null;
let recorder = null;
let porcupine = null;
let cobra = null;
let loopRunning = false;

let state = 'connecting'; // connecting | ready | recording | waiting_reply
let wakeEnabled = false;
let trace = makeTrace();
let speechFrames = [];

let silenceFramesNeeded = 0;
let silentFrames = 0;
let heardSpeech = false;
let recordingStartedAt = 0;

function log(msg) {
  console.log(`[Frank] ${msg}`);
}

function makeTrace() {
  return {
    requestId: `req-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: DEVICE_ID,
  };
}

function safeSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function playBeep(file) {
  spawn('aplay', ['-q', '-D', SPEAKER_DEVICE, file], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

function playBeepSync(file) {
  try {
    execFileSync('aplay', ['-q', '-D', SPEAKER_DEVICE, file], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {}
}

function startPlayer() {
  stopPlayer();

  player = spawn('mpg123', ['-q', '-a', SPEAKER_DEVICE, '-'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });

  player.once('close', () => {
    player = null;

    if (state === 'waiting_reply') {
      state = 'ready';
      wakeEnabled = true;
      trace = makeTrace();
      log('Ready. Listening for wake word...');
    }
  });
}

function stopPlayer() {
  if (!player) return;
  try {
    player.stdin.end();
  } catch {}
  try {
    player.kill();
  } catch {}
  player = null;
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    safeSend({
      type: 'hello',
      trace,
      device: { model: 'rpi', fw: 'wake-cobra-v2' },
    });
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    if (msg.type === 'ready') {
      if (state === 'connecting') {
        state = 'ready';
        wakeEnabled = true;
        log('Ready. Listening for wake word...');
      }
      return;
    }

    if (msg.type === 'transcript') {
      log(`You: ${msg.transcript}`);
      return;
    }

    if (msg.type === 'meta') {
      if (msg.reply?.speak) log(`Frank: ${msg.reply.speak}`);
      return;
    }

    if (msg.type === 'audio') {
      const buf = Buffer.from(msg.bytesBase64, 'base64');
      startPlayer();
      player.stdin.write(buf);
      player.stdin.end();
      return;
    }

    if (msg.type === 'error') {
      log(`Error: ${msg.message}`);
      state = 'ready';
      wakeEnabled = true;
    }
  });

  ws.on('close', () => {
    state = 'connecting';
    wakeEnabled = false;
    setTimeout(connect, 1500);
  });

  ws.on('error', () => {});
}

function initAudio() {
  porcupine = WAKEWORD_PATH
    ? new Porcupine(ACCESS_KEY, [WAKEWORD_PATH], [PORCUPINE_SENSITIVITY])
    : new Porcupine(ACCESS_KEY, [BuiltinKeyword.PORCUPINE], [PORCUPINE_SENSITIVITY]);

  cobra = new Cobra(ACCESS_KEY);

  recorder = new PvRecorder(porcupine.frameLength, MIC_DEVICE_INDEX);
  recorder.start();

  const frameMs = (porcupine.frameLength / SAMPLE_RATE) * 1000;
  silenceFramesNeeded = Math.ceil(END_SILENCE_MS / frameMs);
}

async function audioLoop() {
  if (loopRunning) return;
  loopRunning = true;

  while (true) {
    try {
      const pcm = await recorder.read();

      if (state === 'ready' && wakeEnabled) {
        const hit = porcupine.process(pcm);
        if (hit >= 0) {
          await handleWakeWord();
        }
        continue;
      }

      if (state === 'recording') {
        speechFrames.push(Int16Array.from(pcm));

        const speechProb = cobra.process(pcm);

        if (!heardSpeech) {
          if (speechProb >= START_SPEECH_PROB) {
            heardSpeech = true;
            silentFrames = 0;
          }
        } else {
          if (speechProb >= END_SPEECH_PROB) {
            silentFrames = 0;
          } else {
            silentFrames += 1;
          }
        }

        const elapsed = Date.now() - recordingStartedAt;

        if ((heardSpeech && silentFrames >= silenceFramesNeeded) || elapsed >= MAX_RECORDING_MS) {
          await handleAutoStop();
        }
      }
    } catch {}
  }
}

async function handleWakeWord() {
  if (state !== 'ready') return;

  wakeEnabled = false;

  playBeepSync(BEEP_START_PATH);

  state = 'recording';
  speechFrames = [];
  silentFrames = 0;
  heardSpeech = false;
  recordingStartedAt = Date.now();

  log('Listening...');
}

async function handleAutoStop() {
  if (state !== 'recording') return;

  state = 'waiting_reply';

  playBeep(BEEP_STOP_PATH);

  const wavBuffer = pcmChunksToWav(speechFrames, SAMPLE_RATE);

  safeSend({
    type: 'audio',
    mime: 'audio/wav',
    audioBase64: wavBuffer.toString('base64'),
  });

  speechFrames = [];
  silentFrames = 0;
  heardSpeech = false;
  log('Processing...');
}

function pcmChunksToWav(chunks, sampleRate) {
  const samples = concatInt16(chunks);
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buffer;
}

function concatInt16(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Int16Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

log('Booting...');
connect();
initAudio();
audioLoop().catch(() => {});
