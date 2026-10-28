import { authFailure, getAuthenticatedContext, requireMethod, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);

  return sendJson(response, 200, {
    authenticated: true,
    user: {
      id: context.user.id,
      email: context.user.email ?? null,
      emailVerified: Boolean(context.user.email_confirmed_at)
    },
    profile: context.profile,
    roles: context.roles
  });
}
