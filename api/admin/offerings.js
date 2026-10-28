import { authFailure, getAuthenticatedContext, readBody, requireMethod, requireRoles, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const body = readBody(request);
  if (![body.mentorProfileId, body.specialtyId, body.templateVersionId, body.title].every(value => typeof value === 'string' && value.trim())) {
    return sendJson(response, 400, { error: 'mentor_specialty_template_and_title_required' });
  }
  const { data, error } = await context.db.rpc('admin_create_training_offering', {
    p_mentor_profile_id: body.mentorProfileId,
    p_specialty_id: body.specialtyId,
    p_template_version_id: body.templateVersionId,
    p_title: body.title.trim().slice(0, 180),
    p_description: typeof body.description === 'string' ? body.description.trim().slice(0, 2500) || null : null,
    p_delivery_mode: ['IN_PERSON', 'ONLINE', 'HYBRID'].includes(body.deliveryMode) ? body.deliveryMode : 'IN_PERSON',
    p_publish: body.publish === true
  });
  if (error) return sendJson(response, 400, { error: 'offering_creation_failed', detail: error.message });
  return sendJson(response, 201, { offeringId: data });
}
