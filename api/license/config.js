export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method_not_allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return response.status(503).json({ error: 'license_configuration_missing' });
  }

  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
      return response.status(503).json({ error: 'license_configuration_invalid' });
    }

    return response.status(200).json({
      supabaseUrl: url.origin,
      publishableKey,
      functionName: 'mentoro-license'
    });
  } catch {
    return response.status(503).json({ error: 'license_configuration_invalid' });
  }
}
