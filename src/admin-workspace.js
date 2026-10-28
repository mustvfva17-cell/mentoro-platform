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
      verificationResult, applicationResult, offeringResult, profileResult,
      mentorRolesResult, mentorResult, specialtyResult, templateVersionResult
    ] = await Promise.all([
      supabase.from('verification_documents')
        .select('id,trainee_profile_id,object_path,document_type,status,created_at,review_note,trainee_profiles(university_name,faculty_name,year_of_study,profiles(full_name,email,account_status))')
        .eq('status', 'PENDING').order('created_at', { ascending: true }).limit(100),
      supabase.from('training_applications')
        .select('id,status,created_at,applicant_note,trainee_profiles(university_name,faculty_name,year_of_study,profiles(full_name,email)),training_offerings(title,delivery_mode,mentor_profiles(display_name,professional_title),specialties(name_en)),training_slots(starts_at,ends_at,capacity)')
        .eq('status', 'MENTOR_APPROVED').order('created_at', { ascending: true }).limit(100),
      supabase.from('training_offerings')
        .select('id,title,status,delivery_mode,mentor_profile_id,mentor_profiles(display_name,professional_title),specialties(name_en),training_slots(id,starts_at,ends_at,status,capacity)')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('id').eq('id', user.id).maybeSingle(),
      supabase.from('profile_roles').select('user_id').eq('role', 'MENTOR').is('revoked_at', null),
      supabase.from('mentor_profiles')
        .select('profile_id,display_name,professional_title,institution,is_public,profile_status')
        .eq('profile_status', 'APPROVED').order('display_name', { ascending: true }),
      supabase.from('specialties').select('id,name_en,name_ar').eq('is_active', true).order('name_en', { ascending: true }),
      supabase.from('logbook_template_versions')
        .select('id,template_id,version_number,status,is_assignable,logbook_templates!inner(id,slug,title,specialty_id,is_active)')
        .order('version_number', { ascending: false })
    ]);
    for (const result of [
      verificationResult, applicationResult, offeringResult, profileResult,
      mentorRolesResult, mentorResult, specialtyResult, templateVersionResult
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
    const templateVersions = (templateVersionResult.data || []).map((version) => {
      const related = version.logbook_templates;
      const template = Array.isArray(related) ? related[0] : related;
      return { ...version, template };
    }).filter((version) => version.template?.is_active);
    const applications = applicationResult.data || [];
    const offerings = offeringResult.data || [];
    const pendingSlots = (offering) => (offering.training_slots || []).filter((slot) => slot.status === 'OPEN').length;

    shell(
      '<main class="dashboard">' +
        '<section class="dashboard-welcome"><div><p class="eyebrow">ADMIN WORKSPACE</p><h1>Platform <span>overview</span></h1><p>Review trainee verification, confirm mentor-approved bookings, and manage available training slots.</p></div><span class="status-chip status-chip--neutral">Administrator</span></section>' +
        '<section class="stats-grid">' +
          '<article class="stat-card"><span>Verification queue</span><strong>' + verificationDocs.length + '</strong><small>University documents awaiting review</small></article>' +
          '<article class="stat-card"><span>Bookings to confirm</span><strong>' + applications.length + '</strong><small>Approved by the assigned mentor</small></article>' +
          '<article class="stat-card"><span>Training offerings</span><strong>' + offerings.length + '</strong><small>' + offerings.filter((item) => item.status === 'PUBLISHED').length + ' published</small></article>' +
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
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">LOGBOOK DESIGN</p><h2>Create logbook template draft</h2></div><span class="status-chip status-chip--neutral">Draft only</span></div>' +
          '<p class="workspace-note">Create a specialty-specific draft with a structured field schema and source/reviewer notes. Saving a draft does not make it bookable. Publishing stays blocked until the template is clinically reviewed and the trainee logbook UI fully supports its schema.</p>' +
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
