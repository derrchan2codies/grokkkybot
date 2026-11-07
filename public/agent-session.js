// Shared by the Vercel token route and the browser. No secrets live here.
// Voice sessions use an ElevenLabs conversational agent on Eleven v4 Turbo.
export const AGENT_ID = 'agent_5001m6t8cye6ehf9ch7wq10xad9c';
export const TTS_MODEL = 'eleven_v4_turbo';
export const SIGNED_URL_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url';
export const CONVERSATION_URL = 'wss://api.elevenlabs.io/v1/convai/conversation';
export const CONVERSATION_PATH = new URL(CONVERSATION_URL).pathname;
export const DEFAULT_INPUT_RATE = 16000;
export const DEFAULT_OUTPUT_RATE = 16000;

const AGENT_ID_PATTERN = /^agent_[a-z0-9]{10,80}$/i;
const PCM_RATES = new Set([8000, 16000, 22050, 24000, 44100, 48000]);
const SIGNED_URL_HOSTS = new Set([
  'api.elevenlabs.io',
  'api.us.elevenlabs.io',
  'api.eu.residency.elevenlabs.io',
  'api.in.residency.elevenlabs.io',
  'api.sg.residency.elevenlabs.io'
]);

export function assertAgentId(agentId = AGENT_ID) {
  if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)) {
    throw new Error('A conversational agent ID is required.');
  }
  return agentId;
}

export function signedUrlRequest(agentId = AGENT_ID) {
  const url = new URL(SIGNED_URL_ENDPOINT);
  url.searchParams.set('agent_id', assertAgentId(agentId));
  return url.href;
}

export function buildInitiation(agentId = AGENT_ID) {
  assertAgentId(agentId);
  return {
    type: 'conversation_initiation_client_data',
    conversation_config_override: {
      tts: { model_id: TTS_MODEL }
    }
  };
}

export function parseAudioFormat(format) {
  const match = /^pcm_(\d+)$/.exec(typeof format === 'string' ? format : '');
  const rate = match ? Number(match[1]) : 0;
  if (!PCM_RATES.has(rate)) {
    throw new Error(`Unsupported conversational audio format: ${format || 'missing'}.`);
  }
  return { encoding: 'pcm', rate, format: match[0] };
}

export function assertConversationMetadata(event) {
  const meta = event?.conversation_initiation_metadata_event;
  if (event?.type !== 'conversation_initiation_metadata' || typeof meta?.conversation_id !== 'string' || !meta.conversation_id) {
    throw new Error('Unexpected ElevenLabs conversation metadata.');
  }
  return {
    conversationId: meta.conversation_id,
    input: parseAudioFormat(meta.user_input_audio_format),
    output: parseAudioFormat(meta.agent_output_audio_format)
  };
}

export function assertSignedUrl(signedUrl, agentId = AGENT_ID) {
  const requiredAgentId = assertAgentId(agentId);
  if (typeof signedUrl !== 'string' || !signedUrl) throw new Error('Unexpected ElevenLabs signed URL.');
  let url;
  try { url = new URL(signedUrl); } catch { throw new Error('Unexpected ElevenLabs signed URL.'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash) {
    throw new Error('Unexpected ElevenLabs signed URL.');
  }
  if (!SIGNED_URL_HOSTS.has(url.hostname) || url.pathname !== CONVERSATION_PATH) {
    throw new Error('Unexpected ElevenLabs signed URL.');
  }
  if (url.searchParams.get('agent_id') !== requiredAgentId) {
    throw new Error('Signed URL is missing the required conversational agent ID.');
  }
  // ElevenLabs currently signs with conversation_signature; keep token as a fallback.
  const signature = url.searchParams.get('conversation_signature') || url.searchParams.get('token');
  if (typeof signature !== 'string' || !signature.trim()) {
    throw new Error('Signed URL is missing its conversation signature.');
  }
  return signedUrl;
}
