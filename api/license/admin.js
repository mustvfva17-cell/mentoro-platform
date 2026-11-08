export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method_not_allowed' });
  }

  const authorization = request.headers.authorization || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return response.status(401).json({ error: 'authentication_required' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const publishableKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !publishableKey) {
    return response.status(503).json({ error: 'license_configuration_missing' });
  }

  let endpoint;
  try {
    const base = new URL(supabaseUrl);
    if (base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co')) {
      return response.status(503).json({ error: 'license_configuration_invalid' });
    }
    endpoint = new URL('/functions/v1/mentoro-license', base.origin);
  } catch {
    return response.status(503).json({ error: 'license_configuration_invalid' });
  }

  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {
      return response.status(400).json({ error: 'invalid_json' });
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return response.status(400).json({ error: 'invalid_request' });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: publishableKey,
        Authorization: authorization,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await upstream.text();
    let result;
    try { result = JSON.parse(text); } catch {
      result = { error: 'license_service_invalid_response' };
    }
    return response.status(upstream.status).json(result);
  } catch (error) {
    console.error('License admin proxy failed:', error instanceof Error ? error.message : 'unknown_error');
    return response.status(502).json({ error: 'license_service_unreachable' });
  }
}
