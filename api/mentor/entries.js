import { authFailure, getAuthenticatedContext, requireMethod, requireRoles, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['MENTOR', 'ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'mentor_or_admin_role_required' });

  const { data: entries, error } = await context.db.from('logbook_entries')
    .select('id,instance_id,entry_type,title,entry_date,payload,status,submitted_at,created_at')
    .eq('status', 'SUBMITTED').order('submitted_at', { ascending: true }).limit(200);
  if (error) return sendJson(response, 503, { error: 'submitted_entries_unavailable' });
  if (!entries?.length) return sendJson(response, 200, { entries: [] });

  const { data: instances, error: instanceError } = await context.db.from('logbook_instances')
    .select('id,enrollment_id').in('id', [...new Set(entries.map(row => row.instance_id))]);
  if (instanceError) return sendJson(response, 503, { error: 'logbook_scope_unavailable' });
  const enrollmentIds = [...new Set((instances || []).map(row => row.enrollment_id))];
  if (!enrollmentIds.length) return sendJson(response, 200, { entries: [] });

  const { data: enrollments, error: enrollmentError } = await context.db.from('training_enrollments')
    .select('id,trainee_profile_id,mentor_profile_id,offering_id,specialty_id,status')
    .in('id', enrollmentIds);
  if (enrollmentError) return sendJson(response, 503, { error: 'enrollment_scope_unavailable' });
  const instById = new Map((instances || []).map(row => [row.id, row]));
  const enrollmentById = new Map((enrollments || []).map(row => [row.id, row]));
  return sendJson(response, 200, {
    entries: entries.map(row => {
      const instance = instById.get(row.instance_id);
      const enrollment = instance ? enrollmentById.get(instance.enrollment_id) : null;
      return enrollment && (enrollment.mentor_profile_id === context.user.id || context.roles.some(role => ['ADMIN','SUPER_ADMIN'].includes(role)))
        ? { ...row, enrollment_id: enrollment.id, trainee_profile_id: enrollment.trainee_profile_id, specialty_id: enrollment.specialty_id }
        : null;
    }).filter(Boolean)
  });
}
