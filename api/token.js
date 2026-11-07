// Vercel Node function. Prepares an ElevenAgents conversational agent on
// eleven_v4_turbo and returns a short-lived signed WebSocket URL.
// The browser connects directly; this route never holds the socket.
import {
  AGENT_NAME,
  TTS_MODEL,
  buildAgentUpdate,
  resolveAgentId,
  resolveVoiceId
} from '../public/agent-session.js';

const HINTS = {
  401: 'ElevenLabs rejected ELEVENLABS_API_KEY. Check the key and redeploy.',
  402: 'Check your ElevenLabs billing and available credits.',
  403: 'Your ElevenLabs key or workspace does not have access to conversational agents.',
  404: 'ElevenLabs could not find that conversational agent.',
  422: 'ElevenLabs rejected the conversational agent configuration.',
  429: 'ElevenLabs rate limit or quota reached. Check usage and retry later.'
};

async function eleven(apiKey, path, options = {}) {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    method: options.method || 'GET',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const error = new Error(HINTS[response.status] || `ElevenLabs request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'Set ELEVENLABS_API_KEY in Vercel, then redeploy.' });
  }
  let voiceId = '';
  let requestedAgentId = '';
  try {
    voiceId = resolveVoiceId(process.env.ELEVENLABS_VOICE_ID);
    requestedAgentId = resolveAgentId(process.env.ELEVENLABS_AGENT_ID);
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
  try {
    let agentId = requestedAgentId;
    if (!agentId) {
      const listed = await eleven(apiKey, `/v1/convai/agents?page_size=100&search=${encodeURIComponent(AGENT_NAME)}`);
      const existing = (listed.agents || []).find(agent => agent.name === AGENT_NAME);
      if (existing?.agent_id) agentId = existing.agent_id;
      else {
        const created = await eleven(apiKey, '/v1/convai/agents/create', {
          method: 'POST',
          body: buildAgentUpdate(voiceId)
        });
        if (typeof created.agent_id !== 'string' || !created.agent_id) {
          return res.status(502).json({ error: 'ElevenLabs did not return an agent id.' });
        }
        agentId = created.agent_id;
      }
    }
    await eleven(apiKey, `/v1/convai/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      body: buildAgentUpdate(voiceId, { rename: !requestedAgentId })
    });
    const signed = await eleven(apiKey, `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
    if (typeof signed.signed_url !== 'string' || !signed.signed_url) {
      return res.status(502).json({ error: 'ElevenLabs did not return a signed conversation URL.' });
    }
    return res.status(200).json({ url: signed.signed_url, model: TTS_MODEL });
  } catch (error) {
    return res.status(502).json({ error: error?.name === 'TimeoutError'
      ? 'ElevenLabs request timed out. Please retry.'
      : error.message || 'Could not start an ElevenLabs conversation. Check connectivity and retry.' });
  }
}
