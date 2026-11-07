import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import handler from '../api/token.js';
import { createDownsampler } from '../public/pcm-resample.js';
import {
  INSTRUCTIONS,
  TTS_MODEL,
  assertSignedUrl,
  buildAgentUpdate,
  buildInitiation,
  pcmRate,
  resolveAgentId,
  resolveVoiceId
} from '../public/agent-session.js';

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

const SIGNED = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_test&token=abc';

test('the conversational agent uses eleven_v4_turbo and the kept instructions', () => {
  const update = buildAgentUpdate('');
  assert.equal(update.conversation_config.tts.model_id, 'eleven_v4_turbo');
  assert.equal(update.conversation_config.tts.model_id, TTS_MODEL);
  assert.equal(update.conversation_config.agent.prompt.prompt, INSTRUCTIONS);
  assert.match(INSTRUCTIONS, /helpful, friendly voice assistant/);
  assert.match(INSTRUCTIONS, /Keep replies concise and conversational/);
  assert.match(INSTRUCTIONS, /The user can interrupt you at any time/);
  assert.equal(update.conversation_config.asr.user_input_audio_format, 'pcm_16000');
  assert.equal(update.conversation_config.tts.agent_output_audio_format, 'pcm_16000');
  assert.equal(update.conversation_config.agent.disable_first_message_interruptions, false);
  const initiation = buildInitiation();
  assert.equal(initiation.conversation_config_override.tts.model_id, 'eleven_v4_turbo');
  assert.equal(initiation.conversation_config_override.agent.prompt.prompt, INSTRUCTIONS);
  assert.equal(pcmRate('pcm_16000'), 16000);
  assert.throws(() => pcmRate('ulaw_8000'), /Unsupported audio format/);
  assert.throws(() => resolveVoiceId('brian'), /ELEVENLABS_VOICE_ID/);
  assert.equal(resolveVoiceId(''), '');
  assert.equal(resolveVoiceId('cjVigY5qzO86Huf0OWal'), 'cjVigY5qzO86Huf0OWal');
  assert.throws(() => resolveAgentId('bad id'), /ELEVENLABS_AGENT_ID/);
  assert.doesNotThrow(() => assertSignedUrl(SIGNED));
  assert.throws(() => assertSignedUrl('wss://api.x.ai/v1/realtime'), /Unexpected WebSocket endpoint/);
});

test('48 kHz microphone audio is resampled to 16 kHz PCM16', () => {
  const down = createDownsampler(48000, 16000, 320);
  const chunks = [];
  for (let n = 0; n < 100; n++) chunks.push(...down.push(new Float32Array(480).fill(0.5)));
  const samples = chunks.reduce((sum, chunk) => sum + new Int16Array(chunk.bytes).length, 0);
  assert.equal(samples, 16000);
  assert.ok(new Int16Array(chunks[0].bytes).every(sample => sample === 16384));
});

test('token route rejects anything except POST and a missing key', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const get = mockRes();
    await handler({ method: 'GET' }, get);
    assert.equal(get.statusCode, 405);
    const post = mockRes();
    await handler({ method: 'POST' }, post);
    assert.equal(post.statusCode, 503);
    assert.match(post.body.error, /ELEVENLABS_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
  }
});

test('token route creates an eleven_v4_turbo agent and returns only a signed URL', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  const previousAgent = process.env.ELEVENLABS_AGENT_ID;
  const previousVoice = process.env.ELEVENLABS_VOICE_ID;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  delete process.env.ELEVENLABS_AGENT_ID;
  delete process.env.ELEVENLABS_VOICE_ID;
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body, key: options.headers['xi-api-key'] });
    if (url.includes('/v1/convai/agents?')) return { ok: true, json: async () => ({ agents: [] }) };
    if (url.endsWith('/v1/convai/agents/create')) return { ok: true, json: async () => ({ agent_id: 'agent_created' }) };
    if (url.includes('/v1/convai/agents/agent_created')) return { ok: true, json: async () => ({ agent_id: 'agent_created' }) };
    if (url.includes('/get-signed-url')) return { ok: true, json: async () => ({ signed_url: SIGNED }) };
    throw new Error(`unexpected ${url}`);
  };
  try {
    const res = mockRes();
    await handler({ method: 'POST' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, SIGNED);
    assert.equal(res.body.model, 'eleven_v4_turbo');
    assert.equal(JSON.stringify(res.body).includes('test-key'), false);
    assert.equal(calls[0].key, 'test-key');
    assert.equal(calls[0].headers?.Authorization, undefined);
    const created = JSON.parse(calls[1].body);
    assert.equal(created.conversation_config.tts.model_id, 'eleven_v4_turbo');
    assert.equal(created.conversation_config.agent.prompt.prompt, INSTRUCTIONS);
    const patched = JSON.parse(calls[2].body);
    assert.equal(patched.conversation_config.tts.model_id, 'eleven_v4_turbo');
    assert.match(calls[3].url, /agent_id=agent_created/);
  } finally {
    global.fetch = originalFetch;
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
    if (previousAgent === undefined) delete process.env.ELEVENLABS_AGENT_ID;
    else process.env.ELEVENLABS_AGENT_ID = previousAgent;
    if (previousVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = previousVoice;
  }
});

test('token route reuses an existing agent and hides upstream error bodies', async () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('/v1/convai/agents?')) {
      return { ok: false, status: 401, json: async () => ({ detail: 'secret upstream body' }) };
    }
    throw new Error(`unexpected ${url}`);
  };
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

test('the page keeps its layout and no longer uses Realtime v1', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<h1>Grok Voice<\/h1>/);
  assert.match(html, /Speak to Grok\. Microphone access is required\./);
  assert.match(html, /id="connect"/);
  assert.match(html, /id="level-fill"/);
  assert.match(html, /background: #fff; color: #111/);
  assert.equal(html.includes('eleven_realtime'), false);
  assert.equal(html.includes('api.x.ai'), false);
  assert.equal(html.includes('openai-insecure-api-key'), false);
  assert.match(html, /from '\/agent-session\.js'/);
  assert.match(html, /user_audio_chunk/);
  const shared = readFileSync(new URL('../public/agent-session.js', import.meta.url), 'utf8');
  assert.match(shared, /eleven_v4_turbo/);
  assert.equal(shared.includes('eleven_realtime'), false);
});
