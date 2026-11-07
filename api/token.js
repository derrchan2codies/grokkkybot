// Vercel Node function. Mints a short-lived ElevenLabs Realtime client secret.
// The browser connects directly to the WebSocket; this route never holds the socket.
import { REALTIME_URL, buildSession, resolveVoice } from '../public/realtime-session.js';

const HINTS = {
  401: 'ElevenLabs rejected ELEVENLABS_API_KEY. Check the key and redeploy.',
  402: 'Check your ElevenLabs billing and available credits.',
  403: 'Your ElevenLabs key or workspace does not have access to Realtime.',
  422: 'ElevenLabs rejected the Realtime session configuration.',
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
  let session;
  try {
    session = buildSession(resolveVoice(process.env.ELEVENLABS_VOICE));
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
  try {
    const upstream = await fetch('https://api.elevenlabs.io/v1/convai/realtime/client_secrets', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, expires_after: { anchor: 'created_at', seconds: 600 } }),
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) {
      // Do not reflect raw upstream bodies or secrets into browser error messages.
      return res.status(502).json({ error: HINTS[upstream.status] || `ElevenLabs token request failed (HTTP ${upstream.status}).` });
    }
    const data = await upstream.json();
    if (typeof data.value !== 'string' || !data.value) {
      return res.status(502).json({ error: 'ElevenLabs returned an unexpected token response (missing value).' });
    }
    return res.status(200).json({ token: data.value, expires_at: data.expires_at, url: REALTIME_URL, session });
  } catch (error) {
    return res.status(502).json({ error: error?.name === 'TimeoutError'
      ? 'ElevenLabs token request timed out. Please retry.'
      : 'Could not obtain an ElevenLabs token. Check connectivity and retry.' });
  }
}
