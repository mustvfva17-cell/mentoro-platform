import { getTemplateFields } from './logbook-schema.js';
import { listSpecialtyModules } from './logbooks/module-registry.js';

const REGISTERED_HTML_LOGBOOK_MODULES = listSpecialtyModules().filter((module) =>
  module.renderer === 'HTML' && typeof module.htmlPath === 'string'
);
const REGISTERED_HTML_LOGBOOK_PATHS = new Set(REGISTERED_HTML_LOGBOOK_MODULES.map((module) => module.htmlPath));

export async function renderAdminWorkspace({ user, supabase, shell, esc, dateTime, setBusy, message, errorText }) {
  const renderLoading = () => shell('<main class="dashboard"><section class="loading-panel"><span class="spinner"></span><p>Loading administration workspace…</p></section></main>', user);
  renderLoading();

  const escape = esc || ((value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char])));
  const formatDate = dateTime || ((value) => value ? new Date(value).toLocaleString() : 'Date to be announced');
  const showMessage = message || (() => {});
  const busy = setBusy || ((button, state, label) => {
    if (!button) return;
    if (state) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = label || 'Please wait…'; }
    else { button.disabled = false; button.textContent = button.dataset.originalText || button.textContent; }
  });

  try {
    const [
      verificationResult, applicationResult, offeringResult, enrollmentResult, profileResult,
      mentorRolesResult, mentorResult, specialtyResult, templateVersionResult, traineeProfileResult
    ] = await Promise.all([
      supabase.from('verification_documents')
        .select('id,trainee_profile_id,object_path,document_type,status,created_at,review_note,trainee_profiles(university_name,faculty_name,year_of_study,profiles(full_name,email,account_status))')
        .eq('status', 'PENDING').order('created_at', { ascending: true }).limit(100),
      supabase.from('training_applications')
        .select('id,status,created_at,applicant_note,trainee_profiles(university_name,faculty_name,year_of_study,profiles(full_name,email)),training_offerings(title,delivery_mode,mentor_profiles(display_name,professional_title),specialties(name_en)),training_slots(starts_at,ends_at,capacity)')
        .eq('status', 'MENTOR_APPROVED').order('created_at', { ascending: true }).limit(100),
      supabase.from('training_offerings')
        .select('id,title,status,delivery_mode,mentor_profile_id,template_version_id,mentor_profiles(display_name,professional_title),specialties(name_en),training_slots(id,starts_at,ends_at,status,capacity)')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('training_enrollments')
        .select('id,status,starts_at,ends_at,completed_at,cancelled_at,training_offerings(title),trainee_profiles(university_name,faculty_name,profiles(full_name,email)),mentor_profiles(display_name,professional_title),specialties(name_en)')
        .order('starts_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('id').eq('id', user.id).maybeSingle(),
      supabase.from('profile_roles').select('user_id').eq('role', 'MENTOR').is('revoked_at', null),
      supabase.from('mentor_profiles')
        .select('profile_id,display_name,professional_title,institution,is_public,profile_status')
        .eq('profile_status', 'APPROVED').order('display_name', { ascending: true }),
      supabase.from('specialties').select('id,name_en,name_ar').eq('is_active', true).order('name_en', { ascending: true }),
      supabase.from('logbook_template_versions')
        .select('id,template_id,version_number,status,is_assignable,schema_definition,template_definition,source_notes,created_at,logbook_templates!inner(id,slug,title,description,specialty_id,is_active)')
        .order('version_number', { ascending: false }),
      supabase.from('trainee_profiles')
        .select('profile_id,university_name,faculty_name,year_of_study,profiles!inner(full_name,email,account_status)')
        .order('created_at', { ascending: false }).limit(500)
    ]);
    for (const result of [
      verificationResult, applicationResult, offeringResult, enrollmentResult, profileResult,
      mentorRolesResult, mentorResult, specialtyResult, templateVersionResult, traineeProfileResult
    ]) {
      if (result.error) throw result.error;
    }
    if (!profileResult.data) throw new Error('Administrator profile was not found.');

    // University IDs remain private. Only short-lived signed URLs are created for the admin review screen.
    const verificationDocs = await Promise.all((verificationResult.data || []).map(async (doc) => {
      if (!doc.object_path) return { ...doc, documentPreviewUrl: null };
      const { data, error } = await supabase.storage
        .from('trainee-verification')
        .createSignedUrl(doc.object_path, 300);
      return { ...doc, documentPreviewUrl: error ? null : (data?.signedUrl || null) };
    }));
    const activeMentorIds = new Set((mentorRolesResult.data || []).map((role) => role.user_id));
    const mentors = (mentorResult.data || []).filter((mentor) => activeMentorIds.has(mentor.profile_id));
    const specialties = specialtyResult.data || [];
    const allTemplateVersions = (templateVersionResult.data || []).map((version) => {
      const related = version.logbook_templates;
      const template = Array.isArray(related) ? related[0] : related;
      return { ...version, template, fields: getTemplateFields(version) };
    });
    // Only active templates may be selected for draft offerings. Inactive drafts remain visible in the review queue.
    const templateVersions = allTemplateVersions.filter((version) => version.template?.is_active);
    const latestTemplateById = new Map();
    for (const version of allTemplateVersions) {
      if (!version.template?.id) continue;
      const previous = latestTemplateById.get(version.template.id);
      if (!previous || Number(version.version_number) > Number(previous.latestVersion.version_number)) {
        latestTemplateById.set(version.template.id, { template: version.template, latestVersion: version });
      }
    }
    const existingTemplates = [...latestTemplateById.values()]
      .sort((a, b) => String(a.template.title || a.template.slug).localeCompare(String(b.template.title || b.template.slug)));
    const initialTemplateVersion = existingTemplates[0]?.latestVersion || null;
    const initialVersionSchema = JSON.stringify(initialTemplateVersion?.schema_definition || { fields: [] }, null, 2);
    const initialVersionLayout = JSON.stringify(initialTemplateVersion?.template_definition || { sections: [] }, null, 2);
    const applications = applicationResult.data || [];
    const offerings = offeringResult.data || [];
    const enrollments = enrollmentResult.data || [];
    const traineeProfiles = traineeProfileResult.data || [];
    const assignableHtmlTemplates = templateVersions.filter((version) =>
      version.template?.is_active &&
      version.status === 'PUBLISHED' &&
      version.is_assignable === true &&
      version.template_definition?.renderer === 'HTML' &&
      REGISTERED_HTML_LOGBOOK_PATHS.has(version.template_definition.html_path)
    );
    const assignableTemplateIds = new Set(assignableHtmlTemplates.map((version) => version.id));
    const activeApprovedMentorIds = new Set(mentors.map((mentor) => mentor.profile_id));
    const assignableAdminSlots = offerings.flatMap((offering) => {
      if (offering.status !== 'PUBLISHED' ||
          !activeApprovedMentorIds.has(offering.mentor_profile_id) ||
          !assignableTemplateIds.has(offering.template_version_id)) return [];
      return (offering.training_slots || [])
        .filter((slot) => slot.status === 'OPEN' && new Date(slot.starts_at).getTime() > Date.now())
        .map((slot) => ({ slot, offering }));
    });
    const pendingSlots = (offering) => (offering.training_slots || []).filter((slot) => slot.status === 'OPEN').length;

    shell(
      '<main class="dashboard">' +
        '<section class="dashboard-welcome"><div><p class="eyebrow">ADMIN WORKSPACE</p><h1>Platform <span>overview</span></h1><p>Review trainee verification, confirm mentor-approved bookings, and manage available training slots.</p></div><span class="status-chip status-chip--neutral">Administrator</span></section>' +
        '<section class="stats-grid">' +
          '<article class="stat-card"><span>Verification queue</span><strong>' + verificationDocs.length + '</strong><small>University documents awaiting review</small></article>' +
          '<article class="stat-card"><span>Bookings to confirm</span><strong>' + applications.length + '</strong><small>Approved by the assigned mentor</small></article>' +
          '<article class="stat-card"><span>Training offerings</span><strong>' + offerings.length + '</strong><small>' + offerings.filter((item) => item.status === 'PUBLISHED').length + ' published</small></article>' +
        '</section>' +
        '<section class="section-block" id="admin-enrollment-lifecycle"><div class="section-heading"><div><p class="eyebrow">TRAINING CONTROL</p><h2>Enrollment lifecycle</h2></div><span class="count-badge">' + enrollments.length + '</span></div>' +
          '<p class="workspace-note">Start only during the scheduled window, complete after its scheduled end, or cancel a confirmed/active training with a recorded reason. Status changes are validated by the database and written to the audit log.</p>' +
          (enrollments.length ? '<div class="mentor-queue-grid">' + enrollments.map((enrollment) => {
            const traineeRel = enrollment.trainee_profiles || {};
            const traineeProfile = traineeRel.profiles || {};
            const mentor = enrollment.mentor_profiles || {};
            const offering = enrollment.training_offerings || {};
            const specialty = enrollment.specialties || {};
            const startTime = new Date(enrollment.starts_at).getTime();
            const endTime = new Date(enrollment.ends_at).getTime();
            const now = Date.now();
            let actions = '';
            if (enrollment.status === 'CONFIRMED') {
              actions = startTime > now
                ? '<p class="workspace-note">Start action unlocks at the scheduled start time.</p>'
                : endTime > now
                  ? '<button class="button button--primary button--small" type="button" data-admin-enrollment-action="START" data-enrollment-id="' + escape(enrollment.id) + '">Start training</button>'
                  : '<p class="workspace-note">The scheduled window has passed; review or cancel this enrollment.</p>';
            } else if (enrollment.status === 'ACTIVE') {
              actions = endTime <= now
                ? '<button class="button button--primary button--small" type="button" data-admin-enrollment-action="COMPLETE" data-enrollment-id="' + escape(enrollment.id) + '">Complete training</button>'
                : '<p class="workspace-note">Completion is available after the scheduled end time.</p>';
            }
            if (['CONFIRMED', 'ACTIVE'].includes(enrollment.status)) {
              actions += '<button class="button button--secondary button--small" type="button" data-admin-enrollment-action="CANCEL" data-enrollment-id="' + escape(enrollment.id) + '">Cancel training</button>';
            }
            return '<article class="activity-card admin-enrollment-card" data-admin-enrollment-card>' +
              '<div class="activity-main"><div class="training-card-heading"><span class="specialty-label">' + escape(specialty.name_en || 'Clinical training') + '</span><span class="status-chip status-chip--' + (['CONFIRMED', 'ACTIVE'].includes(enrollment.status) ? 'good' : 'neutral') + '">' + escape(enrollment.status) + '</span></div>' +
              '<h3>' + escape(offering.title || 'Training') + '</h3>' +
              '<p><strong>Trainee:</strong> ' + escape(traineeProfile.full_name || traineeProfile.email || 'Trainee') + '</p>' +
              '<p><strong>Mentor:</strong> ' + escape(mentor.display_name || mentor.professional_title || 'Assigned mentor') + '</p>' +
              '<p>' + escape(formatDate(enrollment.starts_at)) + ' — ' + escape(formatDate(enrollment.ends_at)) + '</p>' +
              (enrollment.completed_at ? '<small>Completed ' + escape(formatDate(enrollment.completed_at)) + '</small>' : '') +
              (enrollment.cancelled_at ? '<small>Cancelled ' + escape(formatDate(enrollment.cancelled_at)) + '</small>' : '') +
              (actions ? '<div class="mentor-review-actions">' + actions + '</div>' : '') +
              '</div></article>';
          }).join('') + '</div>' : '<div class="empty-state"><strong>No confirmed enrollments yet</strong><p>Confirmed bookings appear here when an enrollment and its individual logbook instance are created.</p></div>') +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">IDENTITY & ACCESS</p><h2>Trainee verification</h2></div><span class="count-badge">' + verificationDocs.length + '</span></div>' +
          '<p class="workspace-note">Approving verification unlocks trainee applications. Review the private document in the authorized verification workflow before deciding.</p>' +
          (verificationDocs.length ? '<div class="mentor-queue-grid">' + verificationDocs.map((doc) => {
            const trainee = doc.trainee_profiles || {};
            const profile = trainee.profiles || {};
            return '<article class="activity-card admin-verification-card" data-verification-card>' +
              '<div class="activity-main"><span class="specialty-label">University ID · ' + escape(doc.document_type || 'DOCUMENT') + '</span><h3>' + escape(profile.full_name || profile.email || 'Trainee') + '</h3>' +
              '<p>' + escape([trainee.university_name, trainee.faculty_name, trainee.year_of_study ? 'Year ' + trainee.year_of_study : null].filter(Boolean).join(' · ') || 'Trainee academic details not provided') + '</p>' +
              '<small>Submitted ' + escape(formatDate(doc.created_at)) + '</small>' +
              (doc.documentPreviewUrl
                ? '<p><a class="button button--secondary button--small admin-document-link" href="' + escape(doc.documentPreviewUrl) + '" target="_blank" rel="noopener noreferrer">Open private document · link expires in 5 min</a></p>'
                : '<p class="empty-inline">Private document preview is unavailable. Check the bucket policy and stored object path.</p>') +
              '<label class="field-label" for="verification-note-' + escape(doc.id) + '">Reason for requesting a new document</label><textarea id="verification-note-' + escape(doc.id) + '" data-verification-note rows="2" maxlength="1000" placeholder="Explain what the trainee should correct"></textarea>' +
              '<div class="mentor-review-buttons"><button class="button button--primary button--small" type="button" data-verification-decision="APPROVE" data-trainee-id="' + escape(doc.trainee_profile_id) + '" data-document-id="' + escape(doc.id) + '">Approve trainee</button><button class="button button--secondary button--small" type="button" data-verification-decision="REJECT" data-trainee-id="' + escape(doc.trainee_profile_id) + '" data-document-id="' + escape(doc.id) + '">Request new document</button></div></div></article>';
          }).join('') + '</div>' : '<div class="empty-state"><strong>No verification documents waiting</strong><p>New trainee submissions will appear here.</p></div>') +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">IDENTITY & ACCESS</p><h2>Register a mentor account</h2></div><span class="count-badge">' + mentors.length + '</span></div>' +
          '<p class="workspace-note">The person must create a separate account, select “This is a dedicated Mentor account” during sign-up, and confirm their email. That selection only defers trainee-profile creation; it grants no role. Register the confirmed email here before they sign in. The database rejects admin identities, trainee access, and accounts with trainee history. This does not create an Auth account or publish training automatically.</p>' +
          '<form id="admin-mentor-register-form" class="admin-form-card">' +
            '<div class="admin-form-grid">' +
              '<div class="field"><label for="admin-mentor-email">Existing account email</label><input id="admin-mentor-email" name="email" type="email" required maxlength="320" autocomplete="off" placeholder="mentor@example.com"></div>' +
              '<div class="field"><label for="admin-mentor-name">Display name</label><input id="admin-mentor-name" name="displayName" required maxlength="160" placeholder="Dr. Full Name"></div>' +
              '<div class="field"><label for="admin-mentor-title">Professional title</label><input id="admin-mentor-title" name="professionalTitle" required maxlength="160" placeholder="Consultant / Lecturer / Professor"></div>' +
              '<div class="field"><label for="admin-mentor-institution">Institution</label><input id="admin-mentor-institution" name="institution" maxlength="200" placeholder="Hospital / University"></div>' +
              '<div class="field admin-form-wide"><label for="admin-mentor-bio">Professional bio (optional)</label><textarea id="admin-mentor-bio" name="bio" rows="2" maxlength="2000" placeholder="Specialty and clinical teaching interests"></textarea></div>' +
              '<div class="field admin-form-wide"><label class="checkbox-field"><input name="makePublic" type="checkbox" value="yes"> Make this mentor profile public in the directory</label><small>Leave unchecked during test setup unless you intentionally want the profile visible in public mentor listings.</small></div>' +
              '<div class="field admin-form-wide"><label class="checkbox-field"><input name="dedicatedMentor" type="checkbox" value="yes" required> I confirm this is a dedicated mentor account and I have checked that it has no existing trainee applications, enrollments, or verification records.</label><small>If an account already has trainee history, use a different account. Mentor access takes priority when a profile has multiple active roles.</small></div>' +
            '</div><button class="button button--primary" type="submit">Register mentor access</button></form>' +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">BOOKING CONTROL</p><h2>Mentor-approved applications</h2></div><span class="count-badge">' + applications.length + '</span></div>' +
          '<p class="workspace-note">Confirming an application creates its enrollment and its own independent logbook instance. Confirmation is performed by a server-checked administrator RPC.</p>' +
          (applications.length ? '<div class="mentor-queue-grid">' + applications.map((item) => {
            const trainee = item.trainee_profiles || {};
            const profile = trainee.profiles || {};
            const offering = item.training_offerings || {};
            const mentor = offering.mentor_profiles || {};
            const specialty = offering.specialties || {};
            const slot = item.training_slots || {};
            return '<article class="activity-card admin-application-card" data-admin-application-card><div class="activity-main"><span class="specialty-label">' + escape(specialty.name_en || 'Clinical training') + '</span><h3>' + escape(offering.title || 'Training') + '</h3><p><strong>Trainee:</strong> ' + escape(profile.full_name || profile.email || 'Trainee') + '</p><p><strong>Mentor:</strong> ' + escape(mentor.display_name || 'Assigned mentor') + (mentor.professional_title ? ' · ' + escape(mentor.professional_title) : '') + '</p><p>' + escape(formatDate(slot.starts_at)) + ' — ' + escape(formatDate(slot.ends_at)) + '</p>' +
            (item.applicant_note ? '<p>' + escape(item.applicant_note) + '</p>' : '') +
            '<p class="workspace-note">The decision and logbook creation are recorded by the database workflow.</p>' +
            '<div class="mentor-review-buttons"><button class="button button--primary button--small" type="button" data-confirm-application="' + escape(item.id) + '">Confirm booking & create logbook</button></div></div></article>';
          }).join('') + '</div>' : '<div class="empty-state"><strong>No bookings need confirmation</strong><p>Applications approved by mentors will appear here.</p></div>') +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">EXISTING HTML LOGBOOKS</p><h2>Use a logbook you already have</h2></div><span class="status-chip status-chip--neutral">Existing asset</span></div>' +
          '<p class="workspace-note">These are existing interactive HTML logbooks, not forms we need to rebuild in JSON. Preview the original UI and complete end-to-end trainee and assigned-mentor checks before any clinical template is approved for real enrollment.</p>' +
          '<div class="mentor-queue-grid">' +
            REGISTERED_HTML_LOGBOOK_MODULES.map((module) =>
              '<article class="training-card admin-existing-logbook-card"><div class="training-card-heading"><span class="specialty-label">' + escape(module.name) + '</span><span class="status-chip status-chip--neutral">HTML · ' + escape(module.lifecycle === 'published' ? 'Published' : 'Draft') + '</span></div>' +
                '<h3>' + escape(module.name) + ' Logbook</h3><p class="mentor-line">Central MENTORO HTML runtime using the shared authenticated logbook state and mentor-review bridge.</p>' +
                '<div class="mentor-entry-stats"><span>Registered runtime</span><span>Preview data stays in this browser</span></div>' +
                '<a class="button button--primary button--small" href="' + escape(module.htmlPath + '?mode=preview') + '" target="_blank" rel="noopener noreferrer">Preview existing logbook</a>' +
              '</article>'
            ).join('') +
          '</div>' +
          '<p class="workspace-note">Registered HTML runtimes are previewed here from the central module registry. Preview data is isolated in this browser. Clinical publication and trainee assignment remain blocked until an authorized reviewer completes the required review.</p>' +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">LOGBOOK REVIEW</p><h2>Template versions</h2></div><span class="count-badge">' + allTemplateVersions.length + '</span></div>' +
          '<p class="workspace-note">Review the structure and source notes before any clinical template can be marked assignable. Draft templates are not bookable; this screen does not publish or activate them.</p>' +
          (allTemplateVersions.length ? '<div class="mentor-queue-grid">' + allTemplateVersions.map((version) => {
            const template = version.template || {};
            const specialty = specialties.find((item) => item.id === template.specialty_id) || {};
            const fields = version.fields || [];
            const templateDefinition = version.template_definition || {};
            const isRegisteredHtml = templateDefinition.renderer === 'HTML' &&
              REGISTERED_HTML_LOGBOOK_PATHS.has(templateDefinition.html_path);
            const htmlSections = Array.isArray(templateDefinition.sections) ? templateDefinition.sections : [];
            const definitions = isRegisteredHtml
              ? '<p class="empty-inline">This version uses the registered ' + escape(specialty.name_en || template.title || 'specialty') + ' HTML runtime. It does not use JSON structured fields.</p>' +
                (htmlSections.length
                  ? '<p><strong>Existing views:</strong> ' + escape(htmlSections.join(' · ')) + '</p>'
                  : '') +
                '<p><a class="button button--secondary button--small" href="' + escape(templateDefinition.html_path + '?mode=preview') + '" target="_blank" rel="noopener noreferrer">Preview original HTML logbook</a></p>' +
                '<p class="workspace-note">This standalone preview saves only in this browser. Do not enter patient-identifying information.</p>'
              : fields.length
                ? '<ul class="template-field-list">' + fields.map((field) => '<li><strong>' + escape(field.label) + '</strong><span>' + escape(field.type) + (field.required ? ' · required' : ' · optional') + '</span></li>').join('') + '</ul>'
                : '<p class="empty-inline">No supported structured fields were found in this version. Review its JSON schema before use.</p>';
            const sourceNotes = version.source_notes || template.description || templateDefinition.source || 'No clinical source/reviewer notes recorded.';
            return '<article class="activity-card admin-template-review-card">' +
              '<div class="activity-main"><div class="training-card-heading"><span class="specialty-label">' + escape(specialty.name_en || specialty.name_ar || 'Specialty not found') + '</span>' +
              '<span class="status-chip status-chip--' + (version.status === 'PUBLISHED' && version.is_assignable ? 'good' : 'neutral') + '">' + escape(version.status || 'DRAFT') + (version.is_assignable ? ' · assignable' : ' · not assignable') + '</span></div>' +
              '<h3>' + escape(template.title || template.slug || 'Untitled logbook template') + ' · v' + escape(version.version_number) + '</h3>' +
              '<p>' + escape(template.description || 'No template description.') + '</p>' +
              '<p class="workspace-note"><strong>Clinical source/reviewer notes:</strong> ' + escape(sourceNotes) + '</p>' +
              '<div class="template-review-fields"><strong>Structured fields (' + fields.length + ')</strong>' + definitions + '</div>' +
              (version.status === 'DRAFT' ? '<p class="empty-inline">' + (isRegisteredHtml
                ? 'Pending clinical review. Preview the existing HTML asset, confirm the clinical source/reviewer notes, and record the decision before publishing.'
                : 'Pending clinical review. Publishing remains disabled until the field schema and source are reviewed.') + '</p>' : '') +
              '</div></article>';
          }).join('') + '</div>' : '<div class="empty-state"><strong>No logbook templates yet</strong><p>Create the first specialty-specific draft below.</p></div>') +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">OPTIONAL ADVANCED TOOL</p><h2>Manual template creation</h2></div><span class="status-chip status-chip--neutral">Draft only</span></div>' +
          '<details class="admin-advanced-template-details"><summary>Build a new template from scratch (JSON)</summary>' +
          '<p class="workspace-note">Use this only when no existing HTML logbook is available. It creates a draft definition, not a copy of an existing HTML UI. Saving does not make it bookable; clinical review and a compatible runtime are still required.</p>' +
          (specialties.length ? '<form id="admin-template-form" class="admin-form-card">' +
            '<div class="admin-form-grid">' +
              '<div class="field"><label for="admin-template-title">Template title</label><input id="admin-template-title" name="title" maxlength="160" required placeholder="e.g. General Surgery Clinical Logbook"></div>' +
              '<div class="field"><label for="admin-template-slug">Unique slug</label><input id="admin-template-slug" name="slug" maxlength="100" pattern="[a-z0-9]+(-[a-z0-9]+)*" required placeholder="e.g. general-surgery-v2"></div>' +
              '<div class="field"><label for="admin-template-specialty">Specialty</label><select id="admin-template-specialty" name="specialtyId" required>' + specialties.map((specialty) => '<option value="' + escape(specialty.id) + '">' + escape(specialty.name_en || specialty.name_ar || 'Specialty') + '</option>').join('') + '</select></div>' +
              '<div class="field admin-form-wide"><label for="admin-template-description">Description</label><textarea id="admin-template-description" name="description" rows="2" maxlength="2000" placeholder="Purpose and intended training scope"></textarea></div>' +
              '<div class="field admin-form-wide"><label for="admin-template-schema">Field schema (JSON)</label><textarea id="admin-template-schema" name="schemaDefinition" rows="8" required spellcheck="false">{\n  "fields": [\n    { "key": "clinical_context", "label": "Clinical context", "type": "textarea", "required": true },\n    { "key": "learning_points", "label": "Learning points", "type": "textarea", "required": true }\n  ]\n}</textarea><small>Supported types: text, textarea, date, number, boolean, select. Select fields need 2–50 options.</small></div>' +
              '<div class="field admin-form-wide"><label for="admin-template-layout">Template sections (JSON)</label><textarea id="admin-template-layout" name="templateDefinition" rows="4" required spellcheck="false">{\n  "sections": [\n    { "id": "clinical-activity", "title": "Clinical activity" }\n  ]\n}</textarea></div>' +
              '<div class="field admin-form-wide"><label for="admin-template-source">Clinical source / reviewer notes</label><textarea id="admin-template-source" name="sourceNotes" rows="3" minlength="20" maxlength="4000" required placeholder="Record the curriculum/source and who must review this draft before publication."></textarea></div>' +
            '</div><button class="button button--primary" type="submit">Save template draft</button></form>' :
            '<div class="empty-state"><strong>No active specialties</strong><p>Add an active specialty before drafting a logbook template.</p></div>') +
          '</details>' +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">OPTIONAL ADVANCED TOOL</p><h2>Manual template versioning</h2></div><span class="status-chip status-chip--neutral">Immutable versions</span></div>' +
          '<details class="admin-advanced-template-details"><summary>Create a version using JSON</summary>' +
          '<p class="workspace-note">Use this advanced fallback when a template already exists and its schema needs a new version. The current HTML asset does not need to be re-created here.</p>' +
          (existingTemplates.length ? '<form id="admin-template-version-form" class="admin-form-card">' +
            '<div class="admin-form-grid">' +
              '<div class="field admin-form-wide"><label for="admin-template-version-base">Existing template</label><select id="admin-template-version-base" name="templateId" required>' +
                existingTemplates.map(({ template, latestVersion }) => '<option value="' + escape(template.id) + '">' + escape(template.title || template.slug) + ' · ' + escape(template.slug) + ' · latest v' + escape(latestVersion.version_number) + ' (' + escape(latestVersion.status) + ')</option>').join('') +
              '</select></div>' +
              '<div class="field admin-form-wide"><label for="admin-version-schema">New version field schema (JSON)</label><textarea id="admin-version-schema" name="schemaDefinition" rows="8" required spellcheck="false">' + escape(initialVersionSchema) + '</textarea></div>' +
              '<div class="field admin-form-wide"><label for="admin-version-layout">New version sections (JSON)</label><textarea id="admin-version-layout" name="templateDefinition" rows="4" required spellcheck="false">' + escape(initialVersionLayout) + '</textarea></div>' +
              '<div class="field admin-form-wide"><label for="admin-version-source">New version source / change / reviewer notes</label><textarea id="admin-version-source" name="sourceNotes" rows="3" minlength="20" maxlength="4000" required placeholder="Describe this version’s source, changes, and required clinical reviewer."></textarea></div>' +
            '</div><button class="button button--primary" type="submit">Save next version as draft</button></form>' :
            '<div class="empty-state"><strong>No existing templates to version</strong><p>Create a new specialty template first.</p></div>') +
          '</details>' +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">CLINICAL GOVERNANCE</p><h2>Logbook template review</h2></div><span class="count-badge">' + allTemplateVersions.filter((version) => version.status === 'DRAFT').length + '</span></div>' +
          '<p class="workspace-note">Review the schema and clinical source notes before publishing. Publication makes this version assignable to new training offerings; it does not change existing logbook instances.</p>' +
          (allTemplateVersions.filter((version) => version.status === 'DRAFT').length
            ? '<div class="mentor-queue-grid">' + allTemplateVersions.filter((version) => version.status === 'DRAFT').map((version) => {
              const templateDefinition = version.template_definition || {};
              const isRegisteredHtml = templateDefinition.renderer === 'HTML' &&
                REGISTERED_HTML_LOGBOOK_PATHS.has(templateDefinition.html_path);
              const htmlSections = Array.isArray(templateDefinition.sections) ? templateDefinition.sections : [];
              const canPublishReviewedRuntime = isRegisteredHtml || version.fields.length > 0;
              const runtimeDescription = isRegisteredHtml
                ? '<p><strong>Runtime:</strong> Existing HTML logbook · ' + escape(version.template?.title || 'Registered asset') + '</p>' +
                  '<p><strong>Views:</strong> ' + escape(htmlSections.join(' · ') || 'HTML asset') + '</p>' +
                  '<p><a class="button button--secondary button--small" href="' + escape(templateDefinition.html_path + '?mode=preview') + '" target="_blank" rel="noopener noreferrer">Preview original HTML logbook</a></p>' +
                  '<p class="workspace-note">Preview data stays in this browser. Do not enter patient-identifying information.</p>'
                : '<p><strong>Fields (' + version.fields.length + ')</strong><br>' + escape(version.fields.map((field) => field.label + ' · ' + field.type + (field.required ? ' · required' : '')).join(', ') || 'No valid structured fields') + '</p>';
              return '<article class="activity-card admin-template-review-card" data-template-review-card="' + escape(version.id) + '">' +
                '<div class="activity-main"><span class="specialty-label">' + escape(version.template?.slug || 'Logbook template') + ' · v' + escape(version.version_number) + '</span>' +
                  '<h3>' + escape(version.template?.title || 'Untitled template') + '</h3>' +
                  '<p>' + escape(version.template?.description || 'No description provided.') + '</p>' +
                  '<p><strong>Clinical source / notes</strong><br>' + escape(version.source_notes || 'Missing clinical source notes.') + '</p>' +
                  runtimeDescription +
                  '<label class="field-label" for="template-review-' + escape(version.id) + '">Clinical review decision / notes</label>' +
                  '<textarea id="template-review-' + escape(version.id) + '" data-template-review-notes rows="3" minlength="20" maxlength="4000" required placeholder="Record what was reviewed, the clinical source/curriculum, and any limitations."></textarea>' +
                  '<button class="button button--primary" type="button" data-publish-template="' + escape(version.id) + '"' + (canPublishReviewedRuntime ? '' : ' disabled') + '>Approve review & publish version</button>' +
                '</div></article>';
            }).join('') + '</div>'
            : '<div class="empty-state"><strong>No template drafts awaiting review</strong><p>New drafts will appear here for clinical review before they can be assigned to training.</p></div>') +
        '</section>' +
        '<section class="section-block" id="admin-assign-logbook"><div class="section-heading"><div><p class="eyebrow">TRAINEE RECORDS</p><h2>Assign a training enrollment</h2></div><span class="status-chip status-chip--neutral">Admin only</span></div>' +
          '<p class="workspace-note">Choose a trainee and an available published training slot. The system creates a new enrollment and its own empty logbook atomically; assigning the same specialty again later creates a separate record.</p>' +
          (traineeProfiles.length && assignableAdminSlots.length
            ? '<form id="admin-assign-logbook-form" class="admin-form-card"><div class="admin-form-grid">' +
                '<div class="field"><label for="admin-assignment-trainee">Trainee</label><select id="admin-assignment-trainee" name="traineeId" required><option value="">Select a trainee</option>' +
                  traineeProfiles.map((trainee) => { const p = trainee.profiles || {}; return '<option value="' + escape(trainee.profile_id) + '">' + escape(p.full_name || p.email || trainee.profile_id) + (p.email ? ' · ' + escape(p.email) : '') + '</option>'; }).join('') +
                '</select></div>' +
                '<div class="field"><label for="admin-assignment-slot">Published training slot</label><select id="admin-assignment-slot" name="slotId" required><option value="">Select a training slot</option>' +
                  assignableAdminSlots.map(({ slot, offering }) => { const mentor = offering.mentor_profiles || {}; const specialty = offering.specialties || {}; return '<option value="' + escape(slot.id) + '">' + escape(offering.title || 'Training') + ' · ' + escape(specialty.name_en || 'Specialty') + ' · ' + escape(mentor.display_name || mentor.professional_title || 'Mentor') + ' · ' + escape(formatDate(slot.starts_at)) + '</option>'; }).join('') +
                '</select></div>' +
                '<div class="field admin-form-wide"><label for="admin-assignment-reason">Assignment note (optional)</label><textarea id="admin-assignment-reason" name="reason" rows="2" maxlength="1000" placeholder="Optional context for this training assignment"></textarea></div>' +
              '</div><button class="button button--primary" type="submit">Create enrollment and logbook</button></form>'
            : '<div class="empty-state"><strong>No eligible training slots are available</strong><p>' +
                (!traineeProfiles.length ? 'Create a trainee profile first. ' : '') +
                (!assignableAdminSlots.length ? 'A future open slot with an approved mentor and a published, assignable HTML logbook is required.' : '') +
              '</p></div>') +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">TRAINING SETUP</p><h2>Create training offering</h2></div><span class="status-chip status-chip--neutral">Admin only</span></div>' +
          '<p class="workspace-note">Create a draft offering while its logbook template is being prepared, or publish immediately when the mentor is approved/public and the matching template version is published and assignable. The database validates all constraints.</p>' +
          (mentors.length && specialties.length && templateVersions.length
            ? '<form id="admin-offering-form" class="admin-form-card">' +
                '<div class="admin-form-grid">' +
                  '<div class="field"><label for="admin-offering-title">Offering title</label><input id="admin-offering-title" name="title" maxlength="160" required placeholder="e.g. General Surgery Clinical Training"></div>' +
                  '<div class="field"><label for="admin-offering-mentor">Assigned mentor</label><select id="admin-offering-mentor" name="mentorProfileId" required>' + mentors.map((mentor) => '<option value="' + escape(mentor.profile_id) + '" data-is-public="' + String(mentor.is_public) + '">' + escape(mentor.display_name || mentor.professional_title || mentor.profile_id) + (mentor.professional_title ? ' · ' + escape(mentor.professional_title) : '') + (mentor.is_public ? ' · public' : ' · profile not public') + '</option>').join('') + '</select></div>' +
                  '<div class="field"><label for="admin-offering-specialty">Specialty</label><select id="admin-offering-specialty" name="specialtyId" required>' + specialties.map((specialty) => '<option value="' + escape(specialty.id) + '">' + escape(specialty.name_en || specialty.name_ar || 'Specialty') + '</option>').join('') + '</select></div>' +
                  '<div class="field"><label for="admin-offering-template">Logbook template version</label><select id="admin-offering-template" name="templateVersionId" required>' + templateVersions.map((version) => '<option value="' + escape(version.id) + '" data-specialty-id="' + escape(version.template.specialty_id) + '" data-template-status="' + escape(version.status) + '" data-assignable="' + String(version.is_assignable) + '">' + escape(version.template.title || version.template.slug) + ' · v' + escape(version.version_number) + ' · ' + escape(version.status) + (version.is_assignable ? ' · assignable' : ' · not assignable') + '</option>').join('') + '</select></div>' +
                  '<div class="field"><label for="admin-offering-mode">Delivery mode</label><select id="admin-offering-mode" name="deliveryMode" required><option value="IN_PERSON">In person</option><option value="ONLINE">Online</option><option value="HYBRID">Hybrid</option></select></div>' +
                  '<div class="field admin-form-wide"><label for="admin-offering-description">Description</label><textarea id="admin-offering-description" name="description" rows="3" maxlength="2000" placeholder="Describe the training scope and learning experience"></textarea></div>' +
                '</div>' +
                '<label class="admin-publish-option"><input type="checkbox" name="publishNow" value="yes" disabled> Publish immediately</label>' +
                '<p class="workspace-note" data-admin-publish-hint>Publish availability will update when you select a mentor and matching template version.</p>' +
                '<button class="button button--primary" type="submit">Create offering</button>' +
              '</form>'
            : '<div class="empty-state"><strong>Setup prerequisites are missing</strong><p>' +
                (!mentors.length ? 'No active approved mentor profile was found. ' : '') +
                (!specialties.length ? 'No active specialty is available. ' : '') +
                (!templateVersions.length ? 'Add an active logbook template and version before creating an offering.' : '') +
                '</p></div>') +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">TRAINING OPERATIONS</p><h2>Training offerings & slots</h2></div><span class="count-badge">' + offerings.length + '</span></div>' +
          (offerings.length ? '<div class="mentor-queue-grid">' + offerings.map((offering) => {
            const mentor = offering.mentor_profiles || {};
            const specialty = offering.specialties || {};
            const slots = offering.training_slots || [];
            return '<article class="training-card admin-offering-card" data-offering-card="' + escape(offering.id) + '"><div class="training-card-heading"><span class="specialty-label">' + escape(specialty.name_en || 'Clinical training') + '</span><span class="status-chip status-chip--' + (offering.status === 'PUBLISHED' ? 'good' : 'neutral') + '">' + escape(offering.status || 'DRAFT') + '</span></div><h3>' + escape(offering.title || 'Untitled offering') + '</h3><p class="mentor-line">' + escape(mentor.display_name || 'Mentor not set') + (mentor.professional_title ? ' · ' + escape(mentor.professional_title) : '') + '</p><div class="mentor-entry-stats"><span>' + slots.length + ' total slots</span><span>' + pendingSlots(offering) + ' open</span></div>' +
              (offering.status === 'PUBLISHED' ? '<form class="admin-slot-form" data-create-slot="' + escape(offering.id) + '"><label class="field-label">Add a future slot</label><div class="entry-form-row"><input name="startsAt" type="datetime-local" required aria-label="Slot start"><input name="endsAt" type="datetime-local" required aria-label="Slot end"></div><div class="entry-form-row"><input name="capacity" type="number" min="1" max="100" value="1" required aria-label="Slot capacity"><button class="button button--secondary button--small" type="submit">Create slot</button></div></form>' : '<p class="empty-inline">Publish the offering through the reviewed template workflow before adding bookable slots.</p>') +
              '</article>';
          }).join('') + '</div>' : '<div class="empty-state"><strong>No offerings found</strong><p>Approved mentors and assignable published logbook templates are required before publishing an offering.</p></div>') +
        '</section>' +
      '</main>',
      user
    );

    const templateVersionForm = document.querySelector('#admin-template-version-form');
    if (templateVersionForm) {
      const baseSelect = templateVersionForm.querySelector('[name="templateId"]');
      const schemaInput = templateVersionForm.querySelector('[name="schemaDefinition"]');
      const layoutInput = templateVersionForm.querySelector('[name="templateDefinition"]');
      const latestByTemplateId = new Map(existingTemplates.map((item) => [item.template.id, item.latestVersion]));
      const refreshVersionDefaults = () => {
        const latest = latestByTemplateId.get(baseSelect?.value);
        if (!latest) return;
        schemaInput.value = JSON.stringify(latest.schema_definition || { fields: [] }, null, 2);
        layoutInput.value = JSON.stringify(latest.template_definition || { sections: [] }, null, 2);
      };
      baseSelect?.addEventListener('change', refreshVersionDefaults);
      templateVersionForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(templateVersionForm);
        let schemaDefinition;
        let templateDefinition;
        try {
          schemaDefinition = JSON.parse(String(data.get('schemaDefinition') || ''));
          templateDefinition = JSON.parse(String(data.get('templateDefinition') || ''));
        } catch {
          showMessage('New version schema and sections must be valid JSON.', 'error');
          return;
        }
        const templateId = String(data.get('templateId') || '');
        const sourceNotes = String(data.get('sourceNotes') || '').trim();
        if (!templateId || sourceNotes.length < 20 ||
            !schemaDefinition || typeof schemaDefinition !== 'object' || Array.isArray(schemaDefinition) ||
            !Array.isArray(schemaDefinition.fields) || !schemaDefinition.fields.length ||
            !templateDefinition || typeof templateDefinition !== 'object' || Array.isArray(templateDefinition)) {
          showMessage('Select a template, define at least one field, provide valid sections, and add source/reviewer notes.', 'error');
          return;
        }
        const button = templateVersionForm.querySelector('button[type="submit"]');
        busy(button, true, 'Saving version draft…');
        const { error } = await supabase.rpc('admin_create_logbook_template_version_draft', {
          p_template_id: templateId,
          p_schema_definition: schemaDefinition,
          p_template_definition: templateDefinition,
          p_source_notes: sourceNotes
        });
        if (error) {
          showMessage((errorText || ((err) => err?.message || 'Could not create this template version.'))(error), 'error');
          busy(button, false);
          return;
        }
        await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
        showMessage('The next template version was saved as a draft. Older versions and existing logbooks were left unchanged.', 'success');
      });
    }

    const templateForm = document.querySelector('#admin-template-form');
    if (templateForm) {
      templateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(templateForm);
        let schemaDefinition;
        let templateDefinition;
        try {
          schemaDefinition = JSON.parse(String(data.get('schemaDefinition') || ''));
          templateDefinition = JSON.parse(String(data.get('templateDefinition') || ''));
        } catch {
          showMessage('Field schema and template sections must be valid JSON.', 'error');
          return;
        }
        const title = String(data.get('title') || '').trim();
        const slug = String(data.get('slug') || '').trim();
        const specialtyId = String(data.get('specialtyId') || '');
        const sourceNotes = String(data.get('sourceNotes') || '').trim();
        if (!title || !slug || !specialtyId || sourceNotes.length < 20 ||
            !schemaDefinition || typeof schemaDefinition !== 'object' || Array.isArray(schemaDefinition) ||
            !Array.isArray(schemaDefinition.fields) || !schemaDefinition.fields.length ||
            !templateDefinition || typeof templateDefinition !== 'object' || Array.isArray(templateDefinition)) {
          showMessage('Complete the template details, provide at least one schema field, and add source/reviewer notes.', 'error');
          return;
        }
        const button = templateForm.querySelector('button[type="submit"]');
        busy(button, true, 'Saving draft…');
        const { error } = await supabase.rpc('admin_create_logbook_template_draft', {
          p_specialty_id: specialtyId,
          p_slug: slug,
          p_title: title,
          p_description: String(data.get('description') || '').trim() || null,
          p_schema_definition: schemaDefinition,
          p_template_definition: templateDefinition,
          p_source_notes: sourceNotes
        });
        if (error) {
          showMessage((errorText || ((err) => err?.message || 'Could not save the template draft.'))(error), 'error');
          busy(button, false);
          return;
        }
        await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
        showMessage('Logbook template draft saved. It is not published or assignable yet.', 'success');
      });
    }

    document.querySelectorAll('[data-publish-template]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-template-review-card]');
      const versionId = button.dataset.publishTemplate;
      const reviewNotes = card?.querySelector('[data-template-review-notes]')?.value?.trim() || '';
      if (!versionId || reviewNotes.length < 20) {
        showMessage('Add substantive clinical review notes (at least 20 characters) before publication.', 'error');
        return;
      }
      const confirmed = window.confirm('Publish this reviewed logbook template version? It will become assignable to new training offerings.');
      if (!confirmed) return;
      busy(button, true, 'Publishing reviewed version…');
      const { error } = await supabase.rpc('admin_publish_logbook_template_version', {
        p_version_id: versionId,
        p_review_notes: reviewNotes
      });
      if (error) {
        showMessage((errorText || ((err) => err?.message || 'Could not publish this template version.'))(error), 'error');
        busy(button, false);
        return;
      }
      await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
      showMessage('Template version published and made assignable. Existing logbook instances remain attached to their original version.', 'success');
    }));

    const offeringForm = document.querySelector('#admin-offering-form');
    if (offeringForm) {
      const specialtySelect = offeringForm.querySelector('[name="specialtyId"]');
      const templateSelect = offeringForm.querySelector('[name="templateVersionId"]');
      const mentorSelect = offeringForm.querySelector('[name="mentorProfileId"]');
      const publishToggle = offeringForm.querySelector('[name="publishNow"]');
      const publishHint = offeringForm.querySelector('[data-admin-publish-hint]');
      const filterTemplatesForSpecialty = () => {
        const specialtyId = specialtySelect?.value;
        let firstValidValue = '';
        templateSelect?.querySelectorAll('option').forEach((option) => {
          const matches = option.dataset.specialtyId === specialtyId;
          option.hidden = !matches;
          option.disabled = !matches;
          if (matches && !firstValidValue) firstValidValue = option.value;
        });
        if (templateSelect && ![...templateSelect.options].some((option) => option.value === templateSelect.value && !option.disabled)) {
          templateSelect.value = firstValidValue;
        }
      };
      const refreshPublishAvailability = () => {
        const templateOption = [...(templateSelect?.options || [])].find((option) => option.value === templateSelect?.value && !option.disabled);
        const mentorOption = [...(mentorSelect?.options || [])].find((option) => option.value === mentorSelect?.value);
        const templateReady = templateOption?.dataset.templateStatus === 'PUBLISHED' && templateOption?.dataset.assignable === 'true';
        const mentorPublic = mentorOption?.dataset.isPublic === 'true';
        const canPublish = Boolean(templateReady && mentorPublic);
        if (publishToggle) {
          publishToggle.disabled = !canPublish;
          if (!canPublish) publishToggle.checked = false;
        }
        if (publishHint) {
          publishHint.textContent = !templateReady
            ? 'This template version is not published and assignable yet. You can create a draft offering, but it cannot be booked.'
            : !mentorPublic
              ? 'This mentor profile is not public. Make it public before publishing the offering.'
              : 'Ready to publish. The database will validate mentor, specialty, and template eligibility.';
        }
      };
      specialtySelect?.addEventListener('change', () => {
        filterTemplatesForSpecialty();
        refreshPublishAvailability();
      });
      templateSelect?.addEventListener('change', refreshPublishAvailability);
      mentorSelect?.addEventListener('change', refreshPublishAvailability);
      filterTemplatesForSpecialty();
      refreshPublishAvailability();

      offeringForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(offeringForm);
        const title = String(data.get('title') || '').trim();
        const mentorProfileId = String(data.get('mentorProfileId') || '');
        const specialtyId = String(data.get('specialtyId') || '');
        const templateVersionId = String(data.get('templateVersionId') || '');
        const deliveryMode = String(data.get('deliveryMode') || 'IN_PERSON');
        const publishNow = data.get('publishNow') === 'yes';
        const templateOption = [...(templateSelect?.options || [])].find((option) => option.value === templateVersionId);
        if (!title || !mentorProfileId || !specialtyId || !templateVersionId ||
            !templateOption || templateOption.disabled || templateOption.dataset.specialtyId !== specialtyId) {
          showMessage('Choose a title, an approved mentor, a specialty, and a matching logbook template version.', 'error');
          return;
        }
        if (publishNow && (templateOption.dataset.templateStatus !== 'PUBLISHED' || templateOption.dataset.assignable !== 'true')) {
          showMessage('This logbook template version is not published and assignable. Create a draft offering or select an assignable version.', 'error');
          return;
        }
        const mentorOption = [...offeringForm.querySelector('[name="mentorProfileId"]').options]
          .find((option) => option.value === mentorProfileId);
        if (publishNow && mentorOption?.dataset.isPublic !== 'true') {
          showMessage('This mentor profile is not public yet. Create a draft offering or make the approved mentor profile public first.', 'error');
          return;
        }
        const button = offeringForm.querySelector('button[type="submit"]');
        busy(button, true, publishNow ? 'Publishing offering…' : 'Creating draft…');
        const { error } = await supabase.rpc('admin_create_training_offering', {
          p_mentor_profile_id: mentorProfileId,
          p_specialty_id: specialtyId,
          p_template_version_id: templateVersionId,
          p_title: title,
          p_description: String(data.get('description') || '').trim() || null,
          p_delivery_mode: deliveryMode,
          p_publish: publishNow
        });
        if (error) {
          showMessage((errorText || ((err) => err?.message || 'Could not create the offering.'))(error), 'error');
          busy(button, false);
          return;
        }
        await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
        showMessage(publishNow ? 'Training offering published.' : 'Draft training offering created.', 'success');
      });
    }

    const mentorForm = document.querySelector('#admin-mentor-register-form');
    if (mentorForm) {
      mentorForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(mentorForm);
        const email = String(data.get('email') || '').trim().toLowerCase();
        const displayName = String(data.get('displayName') || '').trim();
        const professionalTitle = String(data.get('professionalTitle') || '').trim();
        const institution = String(data.get('institution') || '').trim();
        const bio = String(data.get('bio') || '').trim();
        const makePublic = data.get('makePublic') === 'yes';
        if (!email || !displayName || !professionalTitle || data.get('dedicatedMentor') !== 'yes') {
          showMessage('Enter the confirmed account email, display name, professional title, and confirm this is a dedicated mentor account.', 'error');
          return;
        }
        const confirmed = window.confirm(
          'Grant Mentor workspace access to the dedicated account ' + displayName + ' (' + email + ')?' +
          '\n\nThe account must have a confirmed email and must not have trainee/admin access or trainee history.' +
          '\n\nPublic directory visibility: ' + (makePublic ? 'ON' : 'OFF') + '.' +
          '\n\nThis will not publish any training offering or logbook template.'
        );
        if (!confirmed) return;
        const button = mentorForm.querySelector('button[type="submit"]');
        busy(button, true, 'Registering mentor…');
        try {
          const { error } = await supabase.rpc('admin_register_mentor_by_email', {
            p_mentor_email: email, p_display_name: displayName, p_professional_title: professionalTitle,
            p_institution: institution || null, p_bio: bio || null, p_make_public: makePublic
          });
          if (error) throw error;
          await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
          showMessage('Mentor access registered. The confirmed account can now sign in to the Mentor workspace. Training and logbook templates remain unchanged.', 'success');
        } catch (error) {
          showMessage((errorText || ((err) => err?.message || 'Could not register mentor access.'))(error), 'error');
          busy(button, false);
        }
      });
    }

    document.querySelectorAll('[data-verification-decision]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-verification-card]');
      const traineeId = button.dataset.traineeId;
      const documentId = button.dataset.documentId;
      const decision = button.dataset.verificationDecision;
      const reason = decision === 'REJECT' ? (card?.querySelector('[data-verification-note]')?.value?.trim() || '') : '';
      if (!traineeId || !documentId || !['APPROVE', 'REJECT'].includes(decision)) return;
      if (decision === 'REJECT' && !reason) {
        showMessage('Add a short reason when requesting a new document.', 'error');
        return;
      }
      card?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      busy(button, true, decision === 'APPROVE' ? 'Approving…' : 'Saving decision…');
      const { error } = await supabase.rpc('admin_review_trainee_verification', {
        p_trainee_profile_id: traineeId, p_document_id: documentId, p_decision: decision, p_reason: reason || null
      });
      if (error) {
        showMessage((errorText || ((err) => err?.message || 'Could not save the verification decision.'))(error), 'error');
        busy(button, false);
        card?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        return;
      }
      await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
      showMessage(decision === 'APPROVE' ? 'Trainee verified.' : 'Verification rejected. The trainee can upload a new document.', 'success');
    }));

    document.querySelector('#admin-assign-logbook-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const traineeId = String(data.get('traineeId') || '');
      const slotId = String(data.get('slotId') || '');
      if (!traineeId || !slotId) return showMessage('Choose a trainee and an available training slot.', 'error');
      if (!window.confirm('Create a new enrollment and a separate empty logbook for this trainee?')) return;
      if (!window.crypto?.randomUUID) {
        showMessage('Secure request identifiers are unavailable in this browser. Please use a modern browser over HTTPS.', 'error');
        return;
      }
      const requestId = form.dataset.requestId || (form.dataset.requestId = window.crypto.randomUUID());
      const button = form.querySelector('button[type="submit"]');
      busy(button, true, 'Creating enrollment…');
      const { error } = await supabase.rpc('admin_assign_trainee_enrollment_logbook', {
        p_trainee_profile_id: traineeId,
        p_slot_id: slotId,
        p_reason: String(data.get('reason') || '').trim() || null,
        p_request_id: requestId
      });
      if (error) {
        showMessage((errorText || ((err) => err?.message || 'Could not create this enrollment.'))(error), 'error');
        busy(button, false);
        return;
      }
      await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
      showMessage('Enrollment created. Its independent logbook is now available in the trainee’s workspace.', 'success');
    });
    const assignmentForm = document.querySelector('#admin-assign-logbook-form');
    assignmentForm?.querySelectorAll('[name="traineeId"], [name="slotId"]').forEach((field) => {
      field.addEventListener('change', () => {
        if (window.crypto?.randomUUID) assignmentForm.dataset.requestId = window.crypto.randomUUID();
      });
    });

    document.querySelectorAll('[data-confirm-application]').forEach((button) => button.addEventListener('click', async () => {
      const applicationId = button.dataset.confirmApplication;
      if (!applicationId) return;
      const card = button.closest('[data-admin-application-card]');
      button.disabled = true;
      busy(button, true, 'Confirming booking…');
      const { error } = await supabase.rpc('admin_confirm_my_application', { p_application_id: applicationId });
      if (error) {
        showMessage((errorText || ((err) => err?.message || 'Could not confirm the booking.'))(error), 'error');
        busy(button, false);
        return;
      }
      await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
      showMessage('Booking confirmed. A separate logbook instance was created for this enrollment.', 'success');
    }));

    document.querySelectorAll('[data-admin-enrollment-action]').forEach((button) => button.addEventListener('click', async () => {
      const enrollmentId = button.dataset.enrollmentId;
      const action = button.dataset.adminEnrollmentAction;
      if (!enrollmentId || !['START', 'COMPLETE', 'CANCEL'].includes(action)) return;

      let reason = null;
      if (action === 'CANCEL') {
        reason = window.prompt('Enter a cancellation reason (10–1000 characters). This is saved in the enrollment audit log.');
        if (reason === null) return;
        reason = reason.trim();
        if (reason.length < 10 || reason.length > 1000) {
          showMessage('Enter a cancellation reason of 10–1000 characters.', 'error');
          return;
        }
      } else {
        const label = action === 'START' ? 'start this training' : 'mark this training as completed';
        if (!window.confirm('Are you sure you want to ' + label + '? This will be recorded in the enrollment audit log.')) return;
      }

      const card = button.closest('[data-admin-enrollment-card]');
      card?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      busy(button, true, action === 'START' ? 'Starting…' : action === 'COMPLETE' ? 'Completing…' : 'Cancelling…');
      const { error } = await supabase.rpc('transition_my_training_enrollment', {
        p_enrollment_id: enrollmentId, p_action: action, p_reason: reason
      });
      if (error) {
        showMessage((errorText || ((err) => err?.message || 'Could not change enrollment status.'))(error), 'error');
        busy(button, false);
        card?.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        return;
      }

      await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
      showMessage(
        action === 'START' ? 'Training started. Enrollment is now active.'
          : action === 'COMPLETE' ? 'Training completed. Its logbook is now read-only for the trainee.'
            : 'Training cancelled. The reason and status change were recorded.',
        'success'
      );
    }));

    document.querySelectorAll('[data-create-slot]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const offeringId = form.dataset.createSlot;
      const data = new FormData(form);
      const startsAtRaw = String(data.get('startsAt') || '');
      const endsAtRaw = String(data.get('endsAt') || '');
      const startsAt = new Date(startsAtRaw);
      const endsAt = new Date(endsAtRaw);
      const capacity = Number(data.get('capacity'));
      if (!offeringId || !startsAtRaw || !endsAtRaw || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || startsAt <= new Date() || !Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
        showMessage('Choose a valid future start/end and capacity from 1 to 100.', 'error');
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      busy(button, true, 'Creating slot…');
      const { error } = await supabase.rpc('admin_create_training_slot', {
        p_offering_id: offeringId, p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(), p_capacity: capacity
      });
      if (error) {
        showMessage((errorText || ((err) => err?.message || 'Could not create the slot.'))(error), 'error');
        busy(button, false);
        return;
      }
      await renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText });
      showMessage('Future training slot created.', 'success');
    }));
  } catch (error) {
    shell('<main class="dashboard"><div class="empty-state empty-state--error"><strong>Could not load administration workspace</strong><p>' + escape((errorText || ((err) => err?.message || 'Unknown error'))(error)) + '</p><button class="button button--secondary" id="admin-retry" type="button">Try again</button></div></main>', user);
    document.querySelector('#admin-retry')?.addEventListener('click', () => renderAdminWorkspace({ user, supabase, shell, esc: escape, dateTime: formatDate, setBusy: busy, message: showMessage, errorText }));
  }
}
