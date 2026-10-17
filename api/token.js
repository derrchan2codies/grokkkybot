// Standard Vercel Node function. No third-party dependencies.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  const { XAI_API_KEY } = process.env;
  if (!XAI_API_KEY) {
    return res.status(503).json({ error: 'Set XAI_API_KEY in Vercel, then redeploy.' });
  }
  try {
    const upstream = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { seconds: 300 } }),
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) {
      // Do not reflect raw upstream bodies or secrets into browser error messages.
      const hints = {
        401: 'xAI rejected XAI_API_KEY. Check the key and redeploy.',
        402: 'Check your xAI billing and available credits.',
        403: 'Your xAI key or team does not have access to this API.',
        429: 'xAI rate limit or quota reached. Check usage and retry later.'
      };
      return res.status(502).json({ error: hints[upstream.status] || `xAI token request failed (HTTP ${upstream.status}).` });
    }
    const data = await upstream.json();
    if (typeof data.value !== 'string' || !data.value) {
      return res.status(502).json({ error: 'xAI returned an unexpected token response (missing value).' });
    }
    const agentId = process.env.XAI_AGENT_ID?.trim() || 'agent_YrA2OJtal0nFg5sO';
    const url = new URL('wss://api.x.ai/v1/realtime');
    if (agentId !== 'none') url.searchParams.set('agent_id', agentId);
    else url.searchParams.set('model', 'grok-voice-latest');
    return res.status(200).json({ token: data.value, expires_at: data.expires_at, url: url.href });
  } catch (error) {
    return res.status(502).json({ error: error?.name === 'TimeoutError'
      ? 'xAI token request timed out. Please retry.'
      : 'Could not obtain an xAI token. Check connectivity and retry.' });
  }
}
