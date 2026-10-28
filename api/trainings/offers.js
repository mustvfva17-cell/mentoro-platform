import { makePublicClient, methodNotAllowed, sendJson } from '../../lib/supabase-server.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
  const db = makePublicClient();
  if (!db) return sendJson(response, 503, { error: 'supabase_configuration_missing' });

  const { data: offerings, error } = await db
    .from('training_offerings')
    .select('id,title,description,delivery_mode,mentor_profile_id,specialty_id,template_version_id,created_at')
    .eq('status', 'PUBLISHED')
    .order('created_at', { ascending: false });
  if (error) return sendJson(response, 503, { error: 'offerings_unavailable' });
  if (!offerings?.length) return sendJson(response, 200, { offerings: [] });

  const offeringIds = offerings.map(row => row.id);
  const mentorIds = [...new Set(offerings.map(row => row.mentor_profile_id))];
  const specialtyIds = [...new Set(offerings.map(row => row.specialty_id))];
  const [mentorResult, specialtyResult, slotResult] = await Promise.all([
    db.from('mentor_profiles').select('profile_id,display_name,professional_title,institution,bio,photo_path').in('profile_id', mentorIds),
    db.from('specialties').select('id,name_en,name_ar,slug').in('id', specialtyIds),
    db.from('training_slots').select('id,offering_id,starts_at,ends_at,capacity,status').in('offering_id', offeringIds).eq('status', 'OPEN').gt('starts_at', new Date().toISOString()).order('starts_at')
  ]);
  if (mentorResult.error || specialtyResult.error || slotResult.error) {
    return sendJson(response, 503, { error: 'offering_details_unavailable' });
  }

  const mentors = new Map((mentorResult.data || []).map(row => [row.profile_id, row]));
  const specialties = new Map((specialtyResult.data || []).map(row => [row.id, row]));
  const slotsByOffering = new Map();
  for (const slot of slotResult.data || []) {
    const list = slotsByOffering.get(slot.offering_id) || [];
    list.push(slot);
    slotsByOffering.set(slot.offering_id, list);
  }

  return sendJson(response, 200, {
    offerings: offerings.map(row => ({
      ...row,
      mentor: mentors.get(row.mentor_profile_id) || null,
      specialty: specialties.get(row.specialty_id) || null,
      slots: slotsByOffering.get(row.id) || []
    })).filter(row => row.mentor && row.specialty && row.slots.length)
  });
}
