const OPEN_ENROLLMENT_STATUSES = new Set(['CONFIRMED', 'ACTIVE']);

/**
 * Poll the current user's enrollment status while an interactive HTML logbook is open.
 * A missing row is treated as closed; transient API failures are retried on the next tick.
 */
export function startEnrollmentLifecycleMonitor({
  supabase,
  enrollmentId,
  intervalMs = 5000,
  isReadOnly = () => false,
  isWindowClosed = () => false,
  onClosed = () => {},
  onWindowClosed = () => {},
  schedule = setInterval,
  unschedule = clearInterval
}) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw new TypeError('A Supabase client is required to monitor enrollment lifecycle.');
  }
  if (!enrollmentId) {
    throw new TypeError('An enrollment ID is required to monitor enrollment lifecycle.');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 1) {
    throw new RangeError('The lifecycle polling interval must be a positive number.');
  }

  let stopped = false;
  let inFlight = false;
  let timer = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
  };

  const refresh = async () => {
    if (stopped) return { status: 'stopped' };
    if (isReadOnly()) {
      stop();
      return { status: 'read-only' };
    }
    if (isWindowClosed()) {
      stop();
      onWindowClosed();
      return { status: 'window-closed' };
    }
    if (inFlight) return { status: 'in-flight' };

    inFlight = true;
    try {
      const { data, error } = await supabase
        .from('training_enrollments')
        .select('id,status')
        .eq('id', enrollmentId)
        .maybeSingle();

      if (error) return { status: 'transient-error', error };
      if (!data || !OPEN_ENROLLMENT_STATUSES.has(data.status)) {
        stop();
        await onClosed();
        return { status: 'closed' };
      }
      return { status: 'open', enrollmentStatus: data.status };
    } catch (error) {
      return { status: 'transient-error', error };
    } finally {
      inFlight = false;
    }
  };

  timer = schedule(() => { void refresh(); }, intervalMs);
  const initialCheck = refresh();

  return {
    stop,
    refresh,
    initialCheck,
    get stopped() {
      return stopped;
    }
  };
}
