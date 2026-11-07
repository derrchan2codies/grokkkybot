import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import handler from '../api/token.js';
import { createDownsampler } from '../public/pcm-resample.js';
import { REALTIME_MODEL, REALTIME_URL, assertRealtimeSession, buildSession, resolveVoice } from '../public/realtime-session.js';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('session config is Eleven Realtime v1 mini at 24 kHz PCM', () => {
  const session = buildSession();
  assert.equal(session.model, 'eleven_realtime_v1_mini');
  assert.equal(session.model, REALTIME_MODEL);
  assert.deepEqual(session.output_modalities, ['audio']);
  assert.deepEqual(session.audio.input.format, { type: 'audio/pcm', rate: 24000 });
  assert.deepEqual(session.audio.output.format, { type: 'audio/pcm' });
  assert.equal(session.audio.output.voice, 'brian');
  assert.equal(session.audio.input.turn_detection.type, 'semantic_vad');
  assert.equal(REALTIME_URL, 'wss://api.elevenlabs.io/v1/convai/realtime');
  assert.doesNotThrow(() => assertRealtimeSession(session));
  assert.throws(() => resolveVoice('has spaces'), /ELEVENLABS_VOICE/);
  assert.equal(resolveVoice(''), 'brian');
  assert.equal(resolveVoice('  Sarah '), 'Sarah');
});

test('48 kHz microphone audio is resampled to 24 kHz PCM16', () => {
  const down = createDownsampler(48000, 24000, 480);
  const chunks = [];
  for (let n = 0; n < 100; n++) chunks.push(...down.push(new Float32Array(480).fill(0.5)));
  const samples = chunks.reduce((sum, chunk) => sum + new Int16Array(chunk.bytes).length, 0);
  assert.equal(samples, 24000);
  const first = new Int16Array(chunks[0].bytes);
  assert.ok(first.every(sample => sample === 16384));
  assert.ok(chunks[0].level > 0.4 && chunks[0].level < 0.6);
});

test('24 kHz audio passes through one sample at a time', () => {
  const down = createDownsampler(24000, 24000, 4);
  const input = Float32Array.from([0, 0.5, -1, 1, 0]);
  const [chunk] = down.push(input);
  assert.deepEqual([...new Int16Array(chunk.bytes)], [0, 16384, -32768, 32767]);
});

test('token route rejects anything except POST and a missing key', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const get = mockRes();
    await handler({ method: 'GET' }, get);
    assert.equal(get.statusCode, 405);
    assert.equal(get.headers.Allow, 'POST');
    const post = mockRes();
    await handler({ method: 'POST' }, post);
    assert.equal(post.statusCode, 503);
    assert.match(post.body.error, /ELEVENLABS_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
  }
});

test('token route mints an ElevenLabs client secret and returns only the browser fields', async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  const previousVoice = process.env.ELEVENLABS_VOICE;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  process.env.ELEVENLABS_VOICE = 'brian';
  const originalFetch = global.fetch;
  let seen;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ value: 'ek_test_secret', expires_at: 123, session: { leak: true } })
    };
  };
  try {
    const res = mockRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(seen.url, 'https://api.elevenlabs.io/v1/convai/realtime/client_secrets');
    assert.equal(seen.options.headers['xi-api-key'], 'test-key');
    assert.equal(seen.options.headers.Authorization, undefined);
    const body = JSON.parse(seen.options.body);
    assert.equal(body.session.model, 'eleven_realtime_v1_mini');
    assert.equal(body.expires_after.anchor, 'created_at');
    assert.equal(body.expires_after.seconds, 600);
    assert.equal(res.body.token, 'ek_test_secret');
    assert.equal(res.body.url, REALTIME_URL);
    assert.equal(res.body.session.audio.output.voice, 'brian');
    assert.equal(res.body.session.leak, undefined);
    assert.equal(JSON.stringify(res.body).includes('test-key'), false);
    assert.doesNotThrow(() => assertRealtimeSession(res.body.session));
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
    if (previousVoice === undefined) delete process.env.ELEVENLABS_VOICE;
    else process.env.ELEVENLABS_VOICE = previousVoice;
  }
});

test('token route hides upstream error bodies', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ detail: 'secret upstream body' }) });
  try {
    const res = mockRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /rejected ELEVENLABS_API_KEY/);
    assert.equal(JSON.stringify(res.body).includes('secret upstream body'), false);
  } finally {
    global.fetch = originalFetch;
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
  }
});

test('the page keeps its layout and no longer calls xAI', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<h1>Grok Voice<\/h1>/);
  assert.match(html, /Speak to Grok\. Microphone access is required\./);
  assert.match(html, /id="connect"/);
  assert.match(html, /id="disconnect"/);
  assert.match(html, /id="level-fill"/);
  assert.match(html, /id="log"/);
  assert.match(html, /background: #fff; color: #111/);
  assert.equal(html.includes('api.x.ai'), false);
  assert.equal(html.includes('XAI_API_KEY'), false);
  assert.equal(html.includes('xai-client-secret'), false);
  assert.match(html, /from '\/realtime-session\.js'/);
  assert.match(html, /openai-insecure-api-key/);
  assert.match(html, /ElevenLabs charges/);
  const shared = readFileSync(new URL('../public/realtime-session.js', import.meta.url), 'utf8');
  assert.match(shared, /wss:\/\/api\.elevenlabs\.io\/v1\/convai\/realtime/);
  assert.match(shared, /eleven_realtime_v1_mini/);
});
