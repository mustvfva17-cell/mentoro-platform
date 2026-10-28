import { authFailure, getAuthenticatedContext, requireMethod, requireRoles, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const { data, error } = await context.db
    .from('training_applications')
    .select('id,trainee_profile_id,offering_id,slot_id,applicant_note,status,mentor_decided_at,mentor_decision_reason,created_at,updated_at')
    .in('status', ['SUBMITTED', 'MENTOR_APPROVED', 'MENTOR_REJECTED'])
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) return sendJson(response, 503, { error: 'admin_applications_unavailable' });
  return sendJson(response, 200, { applications: data || [] });
}
