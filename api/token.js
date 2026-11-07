// Vercel Node function. Mints a short-lived signed URL for the conversational agent.
// The browser connects directly to the WebSocket; this route never holds the socket.
import { AGENT_ID, TTS_MODEL, assertSignedUrl, buildInitiation, signedUrlRequest } from '../public/agent-session.js';

const HINTS = {
  401: 'ElevenLabs rejected ELEVENLABS_API_KEY. Check the key and redeploy.',
  402: 'Check your ElevenLabs billing and available credits.',
  403: 'Your ElevenLabs key cannot access this conversational agent.',
  404: 'ElevenLabs could not find the conversational agent. Check the agent ID.',
  422: 'ElevenLabs rejected the conversational agent request.',
  429: 'ElevenLabs rate limit or quota reached. Check usage and retry later.'
};

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
  let initiation;
  let requestUrl;
  try {
    initiation = buildInitiation(AGENT_ID);
    requestUrl = signedUrlRequest(AGENT_ID);
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
  try {
    const upstream = await fetch(requestUrl, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) {
      // Do not reflect raw upstream bodies or secrets into browser error messages.
      return res.status(502).json({ error: HINTS[upstream.status] || `ElevenLabs token request failed (HTTP ${upstream.status}).` });
    }
    const data = await upstream.json();
    let signedUrl;
    try {
      signedUrl = assertSignedUrl(data.signed_url, AGENT_ID);
    } catch {
      return res.status(502).json({ error: 'ElevenLabs returned an unexpected conversation URL.' });
    }
    return res.status(200).json({
      signed_url: signedUrl,
      agent_id: AGENT_ID,
      model: TTS_MODEL,
      initiation
    });
  } catch (error) {
    return res.status(502).json({ error: error?.name === 'TimeoutError'
      ? 'ElevenLabs token request timed out. Please retry.'
      : 'Could not obtain an ElevenLabs conversation URL. Check connectivity and retry.' });
  }
}
