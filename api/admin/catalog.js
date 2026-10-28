import { authFailure, getAuthenticatedContext, requireMethod, requireRoles, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);
  if (!requireRoles(context, ['ADMIN', 'SUPER_ADMIN'])) return sendJson(response, 403, { error: 'admin_role_required' });

  const [profiles, roles, mentors, specialties, templates, versions, offerings] = await Promise.all([
    context.db.from('profiles').select('id,email,full_name,account_status').order('created_at', { ascending: false }).limit(200),
    context.db.from('profile_roles').select('user_id,role').is('revoked_at', null),
    context.db.from('mentor_profiles').select('profile_id,display_name,professional_title,institution,profile_status,is_public'),
    context.db.from('specialties').select('id,slug,name_en,name_ar,is_active').order('name_en'),
    context.db.from('logbook_templates').select('id,slug,title,specialty_id,is_active').order('title'),
    context.db.from('logbook_template_versions').select('id,template_id,version_number,status,is_assignable,published_at').order('version_number', { ascending: false }),
    context.db.from('training_offerings').select('id,title,mentor_profile_id,specialty_id,template_version_id,status').order('created_at', { ascending: false }).limit(100)
  ]);
  if ([profiles,roles,mentors,specialties,templates,versions,offerings].some(r => r.error)) return sendJson(response, 503, { error: 'admin_catalog_unavailable' });
  return sendJson(response, 200, {
    profiles: profiles.data || [], roles: roles.data || [], mentors: mentors.data || [],
    specialties: specialties.data || [], templates: templates.data || [],
    templateVersions: versions.data || [], offerings: offerings.data || []
  });
}
