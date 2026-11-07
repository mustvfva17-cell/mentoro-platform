export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method_not_allowed' });
  }

  // The pilot branch's Vercel Preview deployment is deliberately pinned to
  // Supabase Development. This cannot select the production project by env.
  // Publishable keys are designed for browser exposure; RLS and server-side
  // authorization remain the security boundary.
  const developmentPreview =
    process.env.VERCEL_ENV === 'preview' &&
    process.env.VERCEL_GIT_COMMIT_REF === 'feat/licensed-standalone-logbooks';

  const supabaseUrl = developmentPreview
    ? 'https://ocsgokwtfwhgeintsokr.supabase.co'
    : process.env.SUPABASE_URL;
  const publishableKey = developmentPreview
    ? 'sb_publishable_9Za7C-wblrwqXIPPT2dT-w_2DWWg1nT'
    : process.env.SUPABASE_PUBLISHABLE_KEY;

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
