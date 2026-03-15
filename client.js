require('dotenv').config();
const WebSocket = require('ws');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

const WS_URL =
  process.env.FRANK_WS_URL || 'wss://irrigative-posttoxic-annie.ngrok-free.dev/v1/device/stream';
const DEVICE_ID = process.env.DEVICE_ID || 'frank-rpi-01';
const MIC_DEVICE = process.env.MIC_DEVICE || 'plughw:1,0';
const SPEAKER_DEVICE = process.env.SPEAKER_DEVICE || 'plughw:1,0';
const FRAME_PATH = '/tmp/frank-frame.png';
const AUDIO_PATH = '/tmp/frank-audio.wav';

if (!WS_URL) {
  console.error('Missing FRANK_WS_URL');
  process.exit(1);
}

let ws = null;
let player = null;
let arecordProc = null;

let state = 'connecting'; // connecting | ready | recording | waiting_reply
let trace = makeTrace();
let frameSeq = 0;

function makeTrace() {
  return {
    requestId: `req-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    sessionId: DEVICE_ID,
  };
}

function log(msg) {
  console.log(`[Frank] ${msg}`);
}

function captureFrameBase64() {
  if (!fs.existsSync(FRAME_PATH)) {
    throw new Error(`Image not found: ${FRAME_PATH}`);
  }
  return fs.readFileSync(FRAME_PATH).toString('base64');

  // Webcam version:
  // execSync(`fswebcam -r 1280x720 --no-banner ${FRAME_PATH}`, { stdio: 'ignore' });
  // return fs.readFileSync(FRAME_PATH).toString('base64');
}

function startRecorder() {
  arecordProc = spawn(
    'arecord',
    ['-D', MIC_DEVICE, '-f', 'S16_LE', '-r', '16000', '-c', '1', AUDIO_PATH],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
}

function stopRecorder() {
  return new Promise((resolve) => {
    if (!arecordProc) return resolve();

    arecordProc.once('close', () => {
      arecordProc = null;
      resolve();
    });

    arecordProc.kill('SIGINT');
  });
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
      log('Ready. Press ENTER to talk.');
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

function safeSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    log('Connected');
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
      if (state === 'connecting') {
        state = 'ready';
        log('Ready. Press ENTER to talk.');
      }
      return;
    }

    if (msg.type === 'ack') {
      return;
    }

    if (msg.type === 'transcript') {
      log(`You said: ${msg.transcript}`);
      return;
    }

    if (msg.type === 'meta') {
      const reply = msg.reply || {};
      if (reply.speak) log(`Frank: ${reply.speak}`);
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
      log(`Server error: ${msg.message}`);
      state = 'ready';
      return;
    }
  });

  ws.on('close', () => {
    log('Disconnected');
    state = 'connecting';
    ws = null;

    setTimeout(() => {
      log('Reconnecting...');
      connect();
    }, 1500);
  });

  ws.on('error', (err) => {
    log(`WS error: ${err.message}`);
  });
}

async function handleEnter() {
  if (state === 'connecting') {
    log('Still connecting...');
    return;
  }

  if (state === 'waiting_reply') {
    log('Still waiting for Frank...');
    return;
  }

  if (state === 'ready') {
    try {
      frameSeq += 1;

      // const frameB64 = captureFrameBase64();
      // safeSend({
      //   type: 'frame',
      //   seq: frameSeq,
      //   mime: 'image/png',
      //   bytesBase64: frameB64,
      // });

      startRecorder();
      state = 'recording';
      log('Listening... Press ENTER to stop.');
    } catch (err) {
      log(`Capture error: ${err.message}`);
      state = 'ready';
    }
    return;
  }

  if (state === 'recording') {
    log('Processing...');
    await stopRecorder();

    const audioB64 = fs.readFileSync(AUDIO_PATH).toString('base64');
    safeSend({
      type: 'audio',
      mime: 'audio/wav',
      audioBase64: audioB64,
    });

    state = 'waiting_reply';
  }
}

console.log('');
log('Booting...');
connect();

process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {
  handleEnter().catch((err) => {
    log(`Client error: ${err.message}`);
    state = 'ready';
  });
});
