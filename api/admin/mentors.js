import { authFailure, getAuthenticatedContext, readBody, requireMethod, requireRoles, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const body = readBody(request);
  if (typeof body.profileId !== 'string' || typeof body.displayName !== 'string' || !body.displayName.trim()) {
    return sendJson(response, 400, { error: 'mentor_profile_and_name_required' });
  }
  const { data, error } = await context.db.rpc('admin_register_mentor', {
    p_mentor_profile_id: body.profileId,
    p_display_name: body.displayName.trim().slice(0, 160),
    p_professional_title: typeof body.professionalTitle === 'string' ? body.professionalTitle.trim().slice(0, 200) || null : null,
    p_institution: typeof body.institution === 'string' ? body.institution.trim().slice(0, 200) || null : null,
    p_bio: typeof body.bio === 'string' ? body.bio.trim().slice(0, 2000) || null : null,
    p_make_public: body.makePublic === true
  });
  if (error) return sendJson(response, 400, { error: 'mentor_registration_failed', detail: error.message });
  return sendJson(response, 201, { mentorProfileId: data });
}
