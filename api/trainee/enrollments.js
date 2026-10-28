import { authFailure, getAuthenticatedContext, requireMethod, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return;
  const context = await getAuthenticatedContext(request);
  if (!context.ok) return authFailure(response, context);

  const { data: enrollments, error } = await context.db
    .from('training_enrollments')
    .select('id,trainee_profile_id,mentor_profile_id,specialty_id,offering_id,slot_id,template_version_id,starts_at,ends_at,status,confirmed_at,completed_at,cancelled_at')
    .order('starts_at', { ascending: false })
    .limit(100);
  if (error) return sendJson(response, 503, { error: 'enrollments_unavailable' });
  if (!enrollments?.length) return sendJson(response, 200, { enrollments: [] });

  const [mentors, specialties, offerings, instances] = await Promise.all([
    context.db.from('mentor_profiles').select('profile_id,display_name,professional_title,institution').in('profile_id', [...new Set(enrollments.map(e => e.mentor_profile_id))]),
    context.db.from('specialties').select('id,name_en,name_ar,slug').in('id', [...new Set(enrollments.map(e => e.specialty_id))]),
    context.db.from('training_offerings').select('id,title').in('id', [...new Set(enrollments.map(e => e.offering_id))]),
    context.db.from('logbook_instances').select('id,enrollment_id,status,created_at,archived_at').in('enrollment_id', enrollments.map(e => e.id))
  ]);
  if (mentors.error || specialties.error || offerings.error || instances.error) return sendJson(response, 503, { error: 'enrollment_details_unavailable' });

  const byId = rows => new Map((rows || []).map(row => [row.profile_id ?? row.id, row]));
  const mentorById = byId(mentors.data);
  const specialtyById = byId(specialties.data);
  const offeringById = byId(offerings.data);
  const instanceByEnrollment = new Map((instances.data || []).map(row => [row.enrollment_id, row]));
  return sendJson(response, 200, {
    enrollments: enrollments.map(row => ({
      ...row,
      mentor: mentorById.get(row.mentor_profile_id) || null,
      specialty: specialtyById.get(row.specialty_id) || null,
      offering: offeringById.get(row.offering_id) || null,
      logbookInstance: instanceByEnrollment.get(row.id) || null
    }))
  });
}
