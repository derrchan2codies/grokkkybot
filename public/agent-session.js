// Shared by the Vercel token route and the browser. No secrets live here.
// eleven_v4_turbo is the conversational agent's text-to-speech model.
export const TTS_MODEL = 'eleven_v4_turbo';
export const AGENT_NAME = 'Voice assistant';
export const INPUT_RATE = 16000;
export const INPUT_FORMAT = 'pcm_16000';
export const OUTPUT_FORMAT = 'pcm_16000';

export const INSTRUCTIONS = 'You are a helpful, friendly voice assistant. Keep replies concise and conversational. The user can interrupt you at any time.';

const VOICE_ID = /^[A-Za-z0-9]{15,40}$/;
const AGENT_ID = /^[A-Za-z0-9_-]{8,80}$/;
const ALLOWED_HOSTS = new Set([
  'api.elevenlabs.io',
  'api.us.elevenlabs.io',
  'api.eu.residency.elevenlabs.io',
  'api.in.residency.elevenlabs.io',
  'api.sg.residency.elevenlabs.io'
]);

export function resolveVoiceId(value) {
  const voiceId = typeof value === 'string' ? value.trim() : '';
  if (!voiceId) return '';
  if (!VOICE_ID.test(voiceId)) throw new Error('ELEVENLABS_VOICE_ID must be an ElevenLabs voice id.');
  return voiceId;
}

export function resolveAgentId(value) {
  const agentId = typeof value === 'string' ? value.trim() : '';
  if (!agentId) return '';
  if (!AGENT_ID.test(agentId)) throw new Error('ELEVENLABS_AGENT_ID is not a valid agent id.');
  return agentId;
}

export function buildAgentUpdate(voiceId, { rename = true } = {}) {
  const tts = { model_id: TTS_MODEL, agent_output_audio_format: OUTPUT_FORMAT };
  if (voiceId) tts.voice_id = voiceId;
  const update = {
    conversation_config: {
      agent: {
        prompt: { prompt: INSTRUCTIONS },
        disable_first_message_interruptions: false
      },
      asr: { user_input_audio_format: INPUT_FORMAT },
      tts
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true } },
          tts: { model_id: true }
        }
      }
    }
  };
  if (rename) update.name = AGENT_NAME;
  return update;
}

export function buildInitiation() {
  return {
    type: 'conversation_initiation_client_data',
    conversation_config_override: {
      agent: { prompt: { prompt: INSTRUCTIONS } },
      tts: { model_id: TTS_MODEL }
    }
  };
}

export function assertSignedUrl(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'wss:' || !ALLOWED_HOSTS.has(endpoint.hostname) || endpoint.pathname !== '/v1/convai/conversation') {
    throw new Error('Unexpected WebSocket endpoint.');
  }
  if (!endpoint.searchParams.get('agent_id')) throw new Error('Unexpected WebSocket endpoint.');
  return endpoint;
}

export function pcmRate(format) {
  const match = /^pcm_(\d+)$/.exec(format || '');
  if (!match) throw new Error(`Unsupported audio format: ${format || 'unknown'}.`);
  return Number(match[1]);
}
