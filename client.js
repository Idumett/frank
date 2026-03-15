//raspberrypi-client
require('dotenv').config();
const WebSocket = require('ws');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

const WS_URL =
  process.env.FRANK_WS_URL || 'https://irrigative-posttoxic-annie.ngrok-free.dev/v1/device/stream';
const DEVICE_ID = process.env.DEVICE_ID || 'frank-rpi-01';
const MIC_DEVICE = process.env.MIC_DEVICE || 'plughw:1,0';
const SPEAKER_DEVICE = process.env.SPEAKER_DEVICE || 'plughw:1,0';
const FRAME_PATH = '/tmp/frank-frame.png';
const AUDIO_PATH = '/tmp/frank-audio.wav';

if (!WS_URL) {
  console.error('Missing FRANK_WS_URL in .env');
  process.exit(1);
}

let ws = null;
let player = null;
let state = 'idle'; // idle | ready | recording | waiting_reply
let trace = null;
let arecordProc = null;

function makeTrace() {
  return {
    requestId: `req-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: DEVICE_ID,
  };
}

function captureFrame() {
  if (true) {
    //for local saved test image
    if (!fs.existsSync(FRAME_PATH)) {
      throw new Error(`Image not found: ${FRAME_PATH}`);
    }
    return fs.readFileSync(FRAME_PATH);
  }

  // for webcam
  // Change this if webcam needs a different command
  execSync(`fswebcam -r 1280x720 --no-banner ${FRAME_PATH}`, { stdio: 'ignore' });
  return fs.readFileSync(FRAME_PATH).toString('base64');
}

function startRecorder() {
  arecordProc = spawn(
    'arecord',
    ['-D', MIC_DEVICE, '-f', 'S16_LE', '-r', '16000', '-c', '1', AUDIO_PATH],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

function stopRecorder() {
  return new Promise((resolve) => {
    if (!arecordProc) return resolve();
    arecordProc.on('close', () => {
      arecordProc = null;
      resolve();
    });
    arecordProc.kill('SIGINT');
  });
}

function startPlayer() {
  player = spawn('mpg123', ['-a', SPEAKER_DEVICE, '-'], {
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

function stopPlayer() {
  if (!player) return;
  try {
    player.stdin.end();
  } catch {}
  player = null;
}

function safeSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connect() {
  trace = makeTrace();
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connected to Frank WS');
    safeSend({
      type: 'hello',
      trace,
      device: { model: 'rpi', fw: 'beta-1' },
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
      console.log('WS ready');

      const frameB64 = captureFrame();
      safeSend({
        type: 'frame',
        seq: 1,
        mime: 'image/png',
        bytesBase64: frameB64.toString('base64'),
      });

      state = 'ready';
      console.log('Press ENTER to start recording');
      return;
    }

    if (msg.type === 'ack') {
      console.log(`Frame acknowledged: ${msg.seq}`);
      return;
    }

    if (msg.type === 'transcript') {
      console.log(`Transcript: ${msg.transcript}`);
      console.log(`STT confidence: ${msg.confidence}`);
      return;
    }

    if (msg.type === 'meta') {
      const reply = msg.reply || {};
      console.log(`Frank reply: ${reply.speak || '(no speak text)'}`);
      console.log(`Suggested action: ${reply.suggestedAction || 'none'}`);
      console.log(`Confidence: ${reply.confidence}`);
      return;
    }

    if (msg.type === 'audio') {
      console.log('Client received audio');

      startPlayer();

      const buf = Buffer.from(msg.bytesBase64, 'base64');
      player.stdin.write(buf);
      player.stdin.end();

      player.on('close', () => {
        console.log('Session ended.\nPress ENTER to start a new one.');
        cleanup();
      });

      return;
    }

    if (msg.type === 'error') {
      console.error(`Server error: ${msg.message}`);
      return;
    }
  });

  ws.on('close', () => {
    cleanup();
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
    cleanup();
  });
}

function cleanup() {
  state = 'idle';
  ws = null;
  stopPlayer();
}

async function handleEnter() {
  if (state === 'idle') {
    connect();
    return;
  }

  if (state === 'ready') {
    console.log('Recording... Press ENTER to stop');
    startRecorder();
    state = 'recording';
    return;
  }

  if (state === 'recording') {
    console.log('Stopping recording...');
    await stopRecorder();

    const audioB64 = fs.readFileSync(AUDIO_PATH).toString('base64');
    safeSend({
      type: 'audio',
      mime: 'audio/wav',
      audioBase64: audioB64,
    });

    state = 'waiting_reply';
    console.log('Audio sent. Waiting for Frank...');
  }
}

console.log('Press ENTER to begin.');

process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {
  handleEnter().catch((err) => {
    console.error(err);
  });
});
