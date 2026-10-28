import { authFailure, getAuthenticatedContext, readBody, requireMethod, requireRoles, sendJson } from '../../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const body = readBody(request);
  if (typeof body.applicationId !== 'string') return sendJson(response, 400, { error: 'application_id_required' });
  const { data, error } = await context.db.rpc('admin_confirm_my_application', { p_application_id: body.applicationId });
  if (error) return sendJson(response, 400, { error: 'booking_confirmation_failed', detail: error.message });
  return sendJson(response, 201, { enrollmentId: data });
}
