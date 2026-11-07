import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import handler from '../api/token.js';
import {
  AGENT_ID,
  TTS_MODEL,
  assertConversationMetadata,
  assertSignedUrl,
  buildInitiation,
  parseAudioFormat,
  signedUrlRequest
} from '../public/agent-session.js';
import { createDownsampler } from '../public/pcm-resample.js';

const SIGNED = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}&conversation_signature=ct_test_secret`;
const SIGNED_LEGACY_TOKEN = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}&token=ct_test_secret`;

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

test('conversation targets the required Eleven v4 Turbo agent', () => {
  assert.equal(AGENT_ID, 'agent_5001m6t8cye6ehf9ch7wq10xad9c');
  assert.equal(TTS_MODEL, 'eleven_v4_turbo');
  const initiation = buildInitiation();
  assert.equal(initiation.type, 'conversation_initiation_client_data');
  assert.equal(initiation.conversation_config_override.tts.model_id, 'eleven_v4_turbo');
  assert.equal(
    signedUrlRequest(),
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`
  );
  assert.throws(() => buildInitiation('missing'), /agent ID is required/);
  assert.equal(assertSignedUrl(SIGNED), SIGNED);
  assert.equal(assertSignedUrl(SIGNED_LEGACY_TOKEN), SIGNED_LEGACY_TOKEN);
  assert.throws(() => assertSignedUrl('wss://api.elevenlabs.io/v1/convai/realtime?agent_id=' + AGENT_ID), /signed URL/i);
  assert.throws(() => assertSignedUrl(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_someoneelse0001&conversation_signature=x`), /agent ID/);
  assert.throws(() => assertSignedUrl(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`), /signature/i);
  assert.deepEqual(parseAudioFormat('pcm_16000'), { encoding: 'pcm', rate: 16000, format: 'pcm_16000' });
  assert.throws(() => parseAudioFormat('ulaw_8000'), /audio format/);
  const metadata = assertConversationMetadata({
    type: 'conversation_initiation_metadata',
    conversation_initiation_metadata_event: {
      conversation_id: 'conv_123',
      user_input_audio_format: 'pcm_16000',
      agent_output_audio_format: 'pcm_24000'
    }
  });
  assert.equal(metadata.conversationId, 'conv_123');
  assert.equal(metadata.input.rate, 16000);
  assert.equal(metadata.output.rate, 24000);
});

test('48 kHz microphone audio is resampled to 16 kHz PCM16 by default', () => {
  const down = createDownsampler(48000, undefined, 320);
  const chunks = [];
  for (let n = 0; n < 100; n++) chunks.push(...down.push(new Float32Array(480).fill(0.5)));
  const samples = chunks.reduce((sum, chunk) => sum + new Int16Array(chunk.bytes).length, 0);
  assert.equal(samples, 16000);
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

test('token route mints a signed conversation URL for the required agent', async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const originalFetch = global.fetch;
  let seen;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ signed_url: SIGNED, leak: true })
    };
  };
  try {
    const res = mockRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(seen.options.method, 'GET');
    assert.equal(seen.url, signedUrlRequest());
    assert.equal(seen.options.headers['xi-api-key'], 'test-key');
    assert.equal(seen.options.headers.Authorization, undefined);
    assert.equal(seen.options.body, undefined);
    assert.equal(res.body.signed_url, SIGNED);
    assert.equal(res.body.agent_id, AGENT_ID);
    assert.equal(res.body.model, 'eleven_v4_turbo');
    assert.equal(res.body.initiation.conversation_config_override.tts.model_id, 'eleven_v4_turbo');
    assert.equal(res.body.leak, undefined);
    assert.equal(JSON.stringify(res.body).includes('test-key'), false);
    assert.doesNotThrow(() => assertSignedUrl(res.body.signed_url));
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
  }
});

test('token route hides upstream error bodies and rejects a mismatched agent URL', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ detail: 'secret upstream body' }) });
    const rejected = mockRes();
    await handler({ method: 'POST' }, rejected);
    assert.equal(rejected.statusCode, 502);
    assert.match(rejected.body.error, /rejected ELEVENLABS_API_KEY/);
    assert.equal(JSON.stringify(rejected.body).includes('secret upstream body'), false);

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_someoneelse0001&conversation_signature=nope' })
    });
    const mismatched = mockRes();
    await handler({ method: 'POST' }, mismatched);
    assert.equal(mismatched.statusCode, 502);
    assert.match(mismatched.body.error, /unexpected conversation URL/);
    assert.equal(JSON.stringify(mismatched.body).includes('someoneelse'), false);
  } finally {
    global.fetch = originalFetch;
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
  }
});

test('the page keeps its layout and talks to the conversational agent', () => {
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
  assert.equal(html.includes('openai-insecure-api-key'), false);
  assert.equal(html.includes('eleven_realtime'), false);
  assert.equal(html.includes('/convai/realtime'), false);
  assert.match(html, /from '\/agent-session\.js'/);
  assert.match(html, /user_audio_chunk/);
  assert.match(html, /buildInitiation/);
  assert.match(html, /new WebSocket\(signedUrl\)/);
  assert.match(html, /ElevenLabs charges/);
  const shared = readFileSync(new URL('../public/agent-session.js', import.meta.url), 'utf8');
  assert.match(shared, /agent_5001m6t8cye6ehf9ch7wq10xad9c/);
  assert.match(shared, /eleven_v4_turbo/);
  assert.match(shared, /wss:\/\/api\.elevenlabs\.io\/v1\/convai\/conversation/);
  assert.equal(shared.includes('eleven_realtime_v1_mini'), false);
  assert.equal(shared.includes('/convai/realtime'), false);
  const worklet = readFileSync(new URL('../public/mic-worklet.js', import.meta.url), 'utf8');
  assert.match(worklet, /DEFAULT_INPUT_RATE/);
  assert.equal(worklet.includes('24000'), false);
});
