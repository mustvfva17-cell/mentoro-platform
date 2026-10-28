import './style.css';
import { createClient } from '@supabase/supabase-js';

const app = document.querySelector('#app');
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, {
  dateStyle: 'medium', timeStyle: 'short'
}) : 'Date to be announced';
const message = (text, kind = 'info') => {
  const node = document.querySelector('#notice');
  if (!node) return;
  node.className = `notice notice--${kind}`;
  node.textContent = text;
  node.hidden = !text;
};
const setBusy = (button, busy, label = 'Please wait…') => {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
};
const errorText = (error) => {
  const known = {
    invalid_credentials: 'Email or password is incorrect.',
    email_not_confirmed: 'Please confirm your email using the link we sent you.',
    user_already_exists: 'An account already exists with this email. Try signing in.',
    auth_configuration_missing: 'The app is not connected to Supabase yet. Add the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables to the Preview deployment.'
  };
  return known[error?.code] || error?.message || 'Something went wrong. Please try again.';
};

function shell(content, user = null) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="MENTORO home">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
          <span class="brand-word">mentoro<span>o</span></span>
        </a>
        <div class="topbar-right">
          <span class="environment-pill">Clinical mentorship</span>
          ${user ? '<button class="button button--quiet button--small" id="sign-out">Sign out</button>' : ''}
        </div>
      </header>
      <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
      ${content}
      <footer class="footer"><span>mentoro</span><span>Structured clinical learning, one training at a time.</span></footer>
    </div>`;
  document.querySelector('#sign-out')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    renderAuth();
  });
}

function renderAuth() {
  shell(`
    <main class="auth-layout">
      <section class="hero">
        <p class="eyebrow">MEDICAL TRAINING, WITH DIRECTION</p>
        <h1>Build clinical confidence.<br><span>With a mentor beside you.</span></h1>
        <p class="hero-copy">A single home for your training applications, verified clinical exposure, and a separate logbook for every confirmed training.</p>
        <div class="value-list">
          <div><span class="value-icon">01</span><div><strong>Real clinical mentorship</strong><p>Find structured training with experienced physicians.</p></div></div>
          <div><span class="value-icon">02</span><div><strong>Your own learning record</strong><p>Every confirmed training gets its own independent logbook.</p></div></div>
          <div><span class="value-icon">03</span><div><strong>Verified trainee access</strong><p>Your university ID is reviewed before applying for training.</p></div></div>
        </div>
      </section>
      <section class="auth-card">
        <div class="card-heading"><p class="eyebrow">GET STARTED</p><h2>Welcome to MENTORO</h2><p>Sign in or create your trainee account.</p></div>
        <div class="tab-list" role="tablist" aria-label="Account access">
          <button class="tab is-active" type="button" data-auth-tab="signin" role="tab" aria-selected="true">Sign in</button>
          <button class="tab" type="button" data-auth-tab="signup" role="tab" aria-selected="false">Create account</button>
        </div>
        <form id="auth-form" class="form-stack">
          <div id="name-field" class="field" hidden><label for="full-name">Full name</label><input id="full-name" name="fullName" autocomplete="name" placeholder="Your full name" minlength="2"></div>
          <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
          <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters" required></div>
          <p class="form-hint" id="auth-hint">Use your registered email to continue.</p>
          <button class="button button--primary button--full" type="submit" id="auth-submit">Sign in</button>
        </form>
        <p class="privacy-note">Your verification documents stay in private storage and are visible only to authorized reviewers.</p>
      </section>
    </main>`);

  let mode = 'signin';
  const form = document.querySelector('#auth-form');
  const nameField = document.querySelector('#name-field');
  const password = document.querySelector('#password');
  const submit = document.querySelector('#auth-submit');
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
    mode = tab.dataset.authTab;
    document.querySelectorAll('[data-auth-tab]').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    nameField.hidden = mode !== 'signup';
    document.querySelector('#full-name').required = mode === 'signup';
    password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    document.querySelector('#auth-hint').textContent = mode === 'signup'
      ? 'Confirm your email before your trainee profile is activated.'
      : 'Use your registered email to continue.';
    submit.textContent = mode === 'signup' ? 'Create trainee account' : 'Sign in';
    message('');
  }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supabase) {
      message('Supabase is not configured for this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the Vercel Preview environment.', 'error');
      return;
    }
    const data = new FormData(form);
    const email = String(data.get('email')).trim().toLowerCase();
    const pass = String(data.get('password'));
    setBusy(submit, true, mode === 'signup' ? 'Creating account…' : 'Signing in…');
    try {
      if (mode === 'signup') {
        const fullName = String(data.get('fullName')).trim();
        const { data: result, error } = await supabase.auth.signUp({
          email, password: pass,
          options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin }
        });
        if (error) throw error;
        if (result.session) {
          const { error: provisionError } = await supabase.rpc('provision_current_trainee', { p_full_name: fullName });
          if (provisionError) throw provisionError;
          await renderDashboard(result.session.user);
        } else {
          document.querySelector('[data-auth-tab="signin"]').click();
          message('Account created. Check your email and confirm your address, then return here to sign in.', 'success');
        }
      } else {
        const { data: result, error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        const fullName = result.user.user_metadata?.full_name || '';
        const { error: provisionError } = await supabase.rpc('provision_current_trainee', { p_full_name: fullName });
        if (provisionError) throw provisionError;
        await renderDashboard(result.user);
      }
    } catch (error) {
      message(errorText(error), 'error');
    } finally {
      setBusy(submit, false);
    }
  });
}

async function renderDashboard(user) {
  shell('<main class="dashboard"><section class="loading-panel"><span class="spinner"></span><p>Preparing your training workspace…</p></section></main>', user);
  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('id,email,full_name,account_status,verification_reason').eq('id', user.id).single();
    if (profileError) throw profileError;
    const [docResult, applicationsResult, enrollmentsResult] = await Promise.all([
      supabase.from('verification_documents').select('id,status,document_type,created_at,review_note').eq('trainee_profile_id', user.id).order('created_at', { ascending: false }).limit(1),
      supabase.from('training_applications').select('id,status,created_at,applicant_note,training_offerings(title,description,delivery_mode,specialties(name_en,name_ar),mentor_profiles(display_name,professional_title)),training_slots(starts_at,ends_at)').eq('trainee_profile_id', user.id).order('created_at', { ascending: false }),
      supabase.from('training_enrollments').select('id,status,starts_at,ends_at,training_offerings(title,mentor_profiles(display_name,professional_title),specialties(name_en,name_ar)),logbook_instances(id,status,logbook_entries(id,title,entry_date,status,entry_type,created_at))').eq('trainee_profile_id', user.id).order('created_at', { ascending: false })
    ]);
    if (applicationsResult.error) throw applicationsResult.error;
    if (enrollmentsResult.error) throw enrollmentsResult.error;
    if (docResult.error) throw docResult.error;
    const latestDoc = docResult.data?.[0] || null;
    const isVerified = profile.account_status === 'VERIFIED';
    const enrollments = enrollmentsResult.data || [];
    const applications = applicationsResult.data || [];
    shell(`
      <main class="dashboard">
        <section class="dashboard-welcome">
          <div><p class="eyebrow">TRAINEE WORKSPACE</p><h1>Welcome back, <span>${esc(profile.full_name || user.email?.split('@')[0] || 'trainee')}</span></h1><p>Manage your verification, training applications, and clinical logbooks from one place.</p></div>
          <span class="status-chip status-chip--${isVerified ? 'good' : 'pending'}">${isVerified ? 'Verified trainee' : 'Verification pending'}</span>
        </section>
        <section class="stats-grid">
          <article class="stat-card"><span>Training applications</span><strong>${applications.length}</strong><small>Across all specialties</small></article>
          <article class="stat-card"><span>My trainings</span><strong>${enrollments.length}</strong><small>Each has its own logbook</small></article>
          <article class="stat-card"><span>Account status</span><strong class="stat-status">${esc(profile.account_status.replaceAll('_', ' '))}</strong><small>Reviewed by MENTORO admin</small></article>
        </section>
        ${!isVerified ? verificationPanel(latestDoc, profile) : ''}
        <section class="section-block">
          <div class="section-heading"><div><p class="eyebrow">DISCOVER</p><h2>Available training</h2></div><p>Applications are available after your trainee account is verified.</p></div>
          <div id="offerings" class="cards-grid"><div class="loading-panel"><span class="spinner"></span><p>Loading available training…</p></div></div>
        </section>
        <section class="section-block">
          <div class="section-heading"><div><p class="eyebrow">YOUR ACTIVITY</p><h2>Applications</h2></div><span class="count-badge">${applications.length}</span></div>
          <div class="list-stack">${applications.length ? applications.map(applicationCard).join('') : '<div class="empty-state"><strong>No applications yet</strong><p>When you apply for a training, its status will appear here.</p></div>'}</div>
        </section>
        <section class="section-block">
          <div class="section-heading"><div><p class="eyebrow">CLINICAL LEARNING</p><h2>My logbooks</h2></div><span class="count-badge">${enrollments.length}</span></div>
          <div class="logbook-grid">${enrollments.length ? enrollments.map(logbookCard).join('') : '<div class="empty-state"><strong>Your logbooks will appear here</strong><p>A separate logbook is created automatically when a training booking is confirmed.</p></div>'}</div>
        </section>
      </main>`, user);
    bindVerificationUpload(user, latestDoc);
    await loadOfferings(user, isVerified);
    bindEntryForms(user);
  } catch (error) {
    shell(`<main class="dashboard"><div class="empty-state empty-state--error"><strong>Could not load your workspace</strong><p>${esc(errorText(error))}</p><button class="button button--secondary" id="retry">Try again</button></div></main>`, user);
    document.querySelector('#retry')?.addEventListener('click', () => renderDashboard(user));
  }
}

function verificationPanel(doc, profile) {
  const status = doc?.status || 'NOT_SUBMITTED';
  const labels = { PENDING: 'Document under review', APPROVED: 'Document approved', REJECTED: 'Document needs attention', SUPERSEDED: 'Replaced by a newer document', NOT_SUBMITTED: 'University ID required' };
  return `
    <section class="verification-panel">
      <div class="verification-copy"><span class="step-number">01</span><div><p class="eyebrow">ACCOUNT VERIFICATION</p><h2>${labels[status] || 'University verification required'}</h2><p>${status === 'PENDING' ? 'Your document has been submitted. You can browse training, but applications unlock after verification.' : esc(profile.verification_reason || doc?.review_note || 'Upload a clear photo or PDF of your university ID. Your document is kept private.')}</p></div></div>
      ${status === 'PENDING' ? '<span class="status-chip status-chip--pending">In review</span>' : `
        <form id="verification-form" class="upload-form">
          <label class="file-drop" for="university-id"><span class="upload-icon">↑</span><strong>Choose university ID</strong><small>JPG, PNG or PDF · max 8 MB</small><input id="university-id" name="document" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" required></label>
          <button class="button button--primary" type="submit" id="upload-submit">Submit for verification</button>
        </form>`}
    </section>`;
}

function applicationCard(item) {
  const offering = item.training_offerings || {};
  const mentor = offering.mentor_profiles || {};
  const specialty = offering.specialties || {};
  return `<article class="activity-card"><div class="activity-main"><span class="specialty-label">${esc(specialty.name_en || 'Clinical training')}</span><h3>${esc(offering.title || 'Training')}</h3><p>${esc(mentor.display_name || 'Mentor to be confirmed')} · ${esc(mentor.professional_title || '')}</p><small>${dateTime(item.training_slots?.starts_at)}</small></div><span class="status-chip status-chip--neutral">${esc((item.status || 'SUBMITTED').replaceAll('_', ' '))}</span></article>`;
}

function logbookCard(enrollment) {
  const offering = enrollment.training_offerings || {};
  const mentor = offering.mentor_profiles || {};
  const specialty = offering.specialties || {};
  const instance = enrollment.logbook_instances?.[0];
  const entries = instance?.logbook_entries || [];
  const draftCount = entries.filter((entry) => entry.status === 'DRAFT').length;
  return `
    <article class="logbook-card">
      <div class="logbook-card-top"><span class="logbook-symbol">M</span><span class="status-chip status-chip--${enrollment.status === 'ACTIVE' ? 'good' : 'neutral'}">${esc(enrollment.status.replaceAll('_', ' '))}</span></div>
      <span class="specialty-label">${esc(specialty.name_en || 'Clinical training')}</span><h3>${esc(offering.title || 'Training logbook')}</h3>
      <p class="mentor-line">${esc(mentor.display_name || 'Assigned mentor')}</p>
      <div class="logbook-meta"><span>${entries.length} entries</span><span>${draftCount} drafts</span></div>
      ${instance ? `
        <form class="entry-form" data-instance-id="${esc(instance.id)}">
          <label for="entry-title-${esc(instance.id)}">Add a clinical learning entry</label>
          <input id="entry-title-${esc(instance.id)}" name="title" placeholder="e.g. Observed central line insertion" maxlength="160" required>
          <div class="entry-form-row"><input name="date" type="date" aria-label="Activity date" required value="${new Date().toISOString().slice(0,10)}"><button class="button button--secondary button--small" type="submit">Save draft</button></div>
        </form>
        ${entries.length ? `<div class="entry-list">${entries.slice(0,4).map((entry) => `<div class="entry-row"><span class="entry-dot entry-dot--${entry.status === 'APPROVED' ? 'good' : 'neutral'}"></span><div><strong>${esc(entry.title)}</strong><small>${esc(entry.entry_date)} · ${esc(entry.status.replaceAll('_',' '))}</small></div>${entry.status === 'DRAFT' ? `<button class="text-button" data-submit-entry="${esc(entry.id)}">Submit</button>` : ''}</div>`).join('')}</div>` : '<p class="empty-inline">Your first entry will appear here.</p>'}
      ` : '<p class="empty-inline">The logbook template is not yet attached to this training.</p>'}
    </article>`;
}

function bindVerificationUpload(user, latestDoc) {
  const form = document.querySelector('#verification-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = new FormData(form).get('document');
    if (!(file instanceof File) || !file.size) return;
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) return message('Upload a JPG, PNG, or PDF file.', 'error');
    if (file.size > 8 * 1024 * 1024) return message('The file must be 8 MB or smaller.', 'error');
    const button = document.querySelector('#upload-submit');
    setBusy(button, true, 'Uploading securely…');
    try {
      const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
      const path = `${user.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('trainee-verification').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: recordError } = await supabase.rpc('record_verification_document', { p_object_path: path, p_document_type: 'UNIVERSITY_ID' });
      if (recordError) throw recordError;
      await renderDashboard(user);
      message('University ID submitted securely. Your account will remain pending until an administrator reviews it.', 'success');
    } catch (error) {
      message(errorText(error), 'error');
      setBusy(button, false);
    }
  });
}

async function loadOfferings(user, isVerified) {
  const target = document.querySelector('#offerings');
  if (!target) return;
  const { data, error } = await supabase.from('training_offerings')
    .select('id,title,description,delivery_mode,specialties(name_en,name_ar),mentor_profiles(display_name,professional_title,institution),training_slots(id,starts_at,ends_at,capacity,status)')
    .eq('status', 'PUBLISHED').order('created_at', { ascending: false });
  if (error) {
    target.innerHTML = '<div class="empty-state"><strong>Training listings are temporarily unavailable</strong><p>Please try again later.</p></div>';
    return;
  }
  const offerings = (data || []).map((offering) => ({
    ...offering,
    openSlots: (offering.training_slots || []).filter((slot) => slot.status === 'OPEN' && new Date(slot.starts_at) > new Date())
  })).filter((offering) => offering.openSlots.length);
  if (!offerings.length) {
    target.innerHTML = '<div class="empty-state"><strong>No open training slots yet</strong><p>Published offerings and future open slots will appear here when MENTORO administration makes them available.</p></div>';
    return;
  }
  target.innerHTML = offerings.map((offering) => {
    const specialty = offering.specialties || {};
    const mentor = offering.mentor_profiles || {};
    return `
      <article class="training-card">
        <div class="training-card-heading"><span class="specialty-label">${esc(specialty.name_en || 'Specialty')}</span><span class="mode-tag">${esc((offering.delivery_mode || 'IN_PERSON').replaceAll('_', ' '))}</span></div>
        <h3>${esc(offering.title)}</h3><p class="mentor-line">${esc(mentor.display_name || 'MENTORO mentor')} · ${esc(mentor.professional_title || '')}</p>
        <p class="training-description">${esc(offering.description || 'Structured clinical training with a dedicated mentor.')}</p>
        <label class="field-label" for="slot-${esc(offering.id)}">Choose an available session</label>
        <select id="slot-${esc(offering.id)}" class="slot-select" data-slot-select="${esc(offering.id)}">
          ${offering.openSlots.map((slot) => `<option value="${esc(slot.id)}">${dateTime(slot.starts_at)} — ${dateTime(slot.ends_at)}</option>`).join('')}
        </select>
        <button class="button button--primary button--full apply-button" data-apply="${esc(offering.id)}" ${isVerified ? '' : 'disabled'}>${isVerified ? 'Apply for training' : 'Verify account to apply'}</button>
      </article>`;
  }).join('');
  target.querySelectorAll('[data-apply]').forEach((button) => button.addEventListener('click', async () => {
    if (!isVerified) return;
    const offeringId = button.dataset.apply;
    const slotId = target.querySelector(`[data-slot-select="${CSS.escape(offeringId)}"]`)?.value;
    if (!slotId) return;
    setBusy(button, true, 'Submitting…');
    const { error: applyError } = await supabase.from('training_applications').insert({
      trainee_profile_id: user.id, offering_id: offeringId, slot_id: slotId, status: 'SUBMITTED'
    });
    if (applyError) {
      message(applyError.code === '23505' ? 'You already have an application for this session.' : errorText(applyError), 'error');
      setBusy(button, false);
      return;
    }
    await renderDashboard(user);
    message('Application submitted. Your mentor will review it, then MENTORO administration confirms the booking.', 'success');
  }));
}

function bindEntryForms(user) {
  document.querySelectorAll('.entry-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, 'Saving…');
    const { error } = await supabase.from('logbook_entries').insert({
      instance_id: form.dataset.instanceId,
      entry_type: 'CLINICAL_ACTIVITY',
      title: String(data.get('title')).trim(),
      entry_date: data.get('date'),
      payload: {},
      status: 'DRAFT',
      created_by: user.id
    });
    if (error) {
      message(errorText(error), 'error');
      setBusy(button, false);
      return;
    }
    await renderDashboard(user);
    message('Draft saved to this training’s logbook.', 'success');
  }));
  document.querySelectorAll('[data-submit-entry]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    const { error } = await supabase.from('logbook_entries')
      .update({ status: 'SUBMITTED', submitted_at: new Date().toISOString() })
      .eq('id', button.dataset.submitEntry).eq('status', 'DRAFT');
    if (error) {
      message(errorText(error), 'error');
      button.disabled = false;
      return;
    }
    await renderDashboard(user);
    message('Entry submitted to your mentor for review.', 'success');
  }));
}

async function start() {
  if (!supabase) {
    renderAuth();
    message('Preview is not connected to Supabase yet. Authentication will work after the two public Vite environment variables are configured.', 'error');
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    try {
      const { error } = await supabase.rpc('provision_current_trainee', {
        p_full_name: session.user.user_metadata?.full_name || ''
      });
      if (error) throw error;
      await renderDashboard(session.user);
    } catch (error) {
      renderAuth();
      message(errorText(error), 'error');
    }
  } else {
    renderAuth();
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) renderAuth();
  });
}

start();
