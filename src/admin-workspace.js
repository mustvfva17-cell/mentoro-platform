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
    const [verificationResult, applicationResult, offeringResult, profileResult] = await Promise.all([
      supabase.from('verification_documents')
        .select('id,trainee_profile_id,document_type,status,created_at,review_note,trainee_profiles(university_name,faculty_name,year_of_study,profiles(full_name,email,account_status))')
        .eq('status', 'PENDING').order('created_at', { ascending: true }).limit(100),
      supabase.from('training_applications')
        .select('id,status,created_at,applicant_note,trainee_profiles(university_name,faculty_name,year_of_study,profiles(full_name,email)),training_offerings(title,delivery_mode,mentor_profiles(display_name,professional_title),specialties(name_en)),training_slots(starts_at,ends_at,capacity)')
        .eq('status', 'MENTOR_APPROVED').order('created_at', { ascending: true }).limit(100),
      supabase.from('training_offerings')
        .select('id,title,status,delivery_mode,mentor_profile_id,mentor_profiles(display_name,professional_title),specialties(name_en),training_slots(id,starts_at,ends_at,status,capacity)')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
    ]);
    for (const result of [verificationResult, applicationResult, offeringResult, profileResult]) {
      if (result.error) throw result.error;
    }
    if (!profileResult.data) throw new Error('Administrator profile was not found.');

    const verificationDocs = verificationResult.data || [];
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
              '<label class="field-label" for="verification-note-' + escape(doc.id) + '">Decision note (optional)</label><textarea id="verification-note-' + escape(doc.id) + '" data-verification-note="' + escape(doc.id) + '" rows="2" maxlength="1000" placeholder="Reason or note for the trainee"></textarea>' +
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
            '<label class="field-label" for="admin-booking-note-' + escape(item.id) + '">Admin note (optional)</label><textarea id="admin-booking-note-' + escape(item.id) + '" data-admin-booking-note="' + escape(item.id) + '" rows="2" maxlength="1000" placeholder="Internal decision note"></textarea>' +
            '<div class="mentor-review-buttons"><button class="button button--primary button--small" type="button" data-confirm-application="' + escape(item.id) + '">Confirm booking & create logbook</button></div></div></article>';
          }).join('') + '</div>' : '<div class="empty-state"><strong>No bookings need confirmation</strong><p>Applications approved by mentors will appear here.</p></div>') +
        '</section>' +
        '<section class="section-block"><div class="section-heading"><div><p class="eyebrow">TRAINING OPERATIONS</p><h2>Published offerings & slots</h2></div><span class="count-badge">' + offerings.length + '</span></div>' +
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

    document.querySelectorAll('[data-verification-decision]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-verification-card]');
      const traineeId = button.dataset.traineeId;
      const documentId = button.dataset.documentId;
      const decision = button.dataset.verificationDecision;
      const reason = card?.querySelector('[data-verification-note]')?.value?.trim() || '';
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
