// Shared by the Vercel token route and the browser. No secrets live here.
export const REALTIME_URL = 'wss://api.elevenlabs.io/v1/convai/realtime';
export const REALTIME_MODEL = 'eleven_realtime_v1_mini';
export const DEFAULT_VOICE = 'brian';
export const SAMPLE_RATE = 24000;

export const INSTRUCTIONS = 'You are a helpful, friendly voice assistant where a user will always speak to you in English and you will always answer in Cantonese (yue). Keep replies concise and conversational. The user can interrupt you at any time.';

const VOICE_PATTERN = /^[a-z0-9_-]{1,64}$/i;

export function resolveVoice(value) {
  const voice = typeof value === 'string' ? value.trim() : '';
  if (!voice) return DEFAULT_VOICE;
  if (!VOICE_PATTERN.test(voice)) {
    throw new Error('ELEVENLABS_VOICE must be 1-64 letters, numbers, underscores, or hyphens.');
  }
  return voice;
}

export function buildSession(voice = DEFAULT_VOICE) {
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: INSTRUCTIONS,
    output_modalities: ['audio'],
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: SAMPLE_RATE },
        transcription: { language: 'en' },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true
        }
      },
      output: {
        format: { type: 'audio/pcm' },
        voice
      }
    }
  };
}

export function assertRealtimeSession(session) {
  if (!session || session.type !== 'realtime' || session.model !== REALTIME_MODEL) {
    throw new Error('Unexpected ElevenLabs session configuration.');
  }
  const input = session.audio?.input?.format;
  const output = session.audio?.output?.format;
  if (input?.type !== 'audio/pcm' || input.rate !== SAMPLE_RATE || output?.type !== 'audio/pcm') {
    throw new Error('Unexpected ElevenLabs audio format.');
  }
  if (session.audio?.input?.turn_detection?.type !== 'semantic_vad') {
    throw new Error('Unexpected ElevenLabs turn detection.');
  }
  const modalities = session.output_modalities;
  if (!Array.isArray(modalities) || modalities.length !== 1 || modalities[0] !== 'audio') {
    throw new Error('Unexpected ElevenLabs output modality.');
  }
  if (typeof session.audio?.output?.voice !== 'string' || !session.audio.output.voice) {
    throw new Error('Unexpected ElevenLabs voice.');
  }
}
