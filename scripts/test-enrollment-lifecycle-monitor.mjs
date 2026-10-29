import assert from 'node:assert/strict';
import { startEnrollmentLifecycleMonitor } from '../src/enrollment-lifecycle-monitor.js';

function makeScheduler() {
  let nextId = 0;
  const callbacks = new Map();
  const cleared = [];
  const intervals = [];
  return {
    callbacks,
    cleared,
    intervals,
    schedule(callback, delay) {
      const id = ++nextId;
      callbacks.set(id, callback);
      intervals.push({ id, delay });
      return id;
    },
    unschedule(id) {
      cleared.push(id);
      callbacks.delete(id);
    }
  };
}

function makeSupabase(getResponse) {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'training_enrollments');
      const call = { table, columns: null, filterColumn: null, filterValue: null };
      calls.push(call);
      return {
        select(columns) {
          call.columns = columns;
          return this;
        },
        eq(column, value) {
          call.filterColumn = column;
          call.filterValue = value;
          return this;
        },
        async maybeSingle() {
          return await getResponse(call, calls.length);
        }
      };
    }
  };
  return { client, calls };
}

const enrollmentId = 'a13a1e5e-f1d3-4a23-8ea8-f9709e8a56bb';

{
  let response = { data: { id: enrollmentId, status: 'ACTIVE' }, error: null };
  const supabase = makeSupabase(() => response);
  const scheduler = makeScheduler();
  let closedCalls = 0;
  const monitor = startEnrollmentLifecycleMonitor({
    supabase: supabase.client,
    enrollmentId,
    intervalMs: 5000,
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule,
    onClosed: () => { closedCalls += 1; }
  });

  assert.deepEqual(await monitor.initialCheck, { status: 'open', enrollmentStatus: 'ACTIVE' });
  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].columns, 'id,status');
  assert.equal(supabase.calls[0].filterColumn, 'id');
  assert.equal(supabase.calls[0].filterValue, enrollmentId);
  assert.deepEqual(scheduler.intervals.map((item) => item.delay), [5000]);
  assert.equal(closedCalls, 0);

  response = { data: { id: enrollmentId, status: 'COMPLETED' }, error: null };
  assert.deepEqual(await monitor.refresh(), { status: 'closed' });
  assert.equal(closedCalls, 1);
  assert.equal(monitor.stopped, true);
  assert.deepEqual(scheduler.cleared, [scheduler.intervals[0].id]);
  assert.deepEqual(await monitor.refresh(), { status: 'stopped' });
  assert.equal(supabase.calls.length, 2);
  console.log('PASS active enrollment transitions to read-only on completion and stops polling');
}

{
  const supabase = makeSupabase(() => ({ data: null, error: null }));
  const scheduler = makeScheduler();
  let closedCalls = 0;
  const monitor = startEnrollmentLifecycleMonitor({
    supabase: supabase.client,
    enrollmentId,
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule,
    onClosed: () => { closedCalls += 1; }
  });
  assert.deepEqual(await monitor.initialCheck, { status: 'closed' });
  assert.equal(closedCalls, 1);
  assert.equal(monitor.stopped, true);
  console.log('PASS missing enrollment fails closed');
}

{
  let response = { data: null, error: new Error('temporary network failure') };
  const supabase = makeSupabase(() => response);
  const scheduler = makeScheduler();
  let closedCalls = 0;
  const monitor = startEnrollmentLifecycleMonitor({
    supabase: supabase.client,
    enrollmentId,
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule,
    onClosed: () => { closedCalls += 1; }
  });
  assert.equal((await monitor.initialCheck).status, 'transient-error');
  assert.equal(monitor.stopped, false);
  response = { data: { id: enrollmentId, status: 'CONFIRMED' }, error: null };
  assert.deepEqual(await monitor.refresh(), { status: 'open', enrollmentStatus: 'CONFIRMED' });
  assert.equal(closedCalls, 0);
  monitor.stop();
  assert.equal(monitor.stopped, true);
  console.log('PASS transient status-read errors retry without falsely closing an open enrollment');
}

{
  const supabase = makeSupabase(() => ({ data: { id: enrollmentId, status: 'ACTIVE' }, error: null }));
  const scheduler = makeScheduler();
  let closedCalls = 0;
  let windowClosedCalls = 0;
  const monitor = startEnrollmentLifecycleMonitor({
    supabase: supabase.client,
    enrollmentId,
    isWindowClosed: () => true,
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule,
    onClosed: () => { closedCalls += 1; },
    onWindowClosed: () => { windowClosedCalls += 1; }
  });
  assert.deepEqual(await monitor.initialCheck, { status: 'window-closed' });
  assert.equal(supabase.calls.length, 0);
  assert.equal(closedCalls, 0);
  assert.equal(windowClosedCalls, 1);
  assert.equal(monitor.stopped, true);
  console.log('PASS closed popup stops polling without querying enrollment state');
}

{
  let resolveRequest;
  const supabase = makeSupabase(() => new Promise((resolve) => { resolveRequest = resolve; }));
  const scheduler = makeScheduler();
  const monitor = startEnrollmentLifecycleMonitor({
    supabase: supabase.client,
    enrollmentId,
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule
  });
  const initial = monitor.initialCheck;
  assert.deepEqual(await monitor.refresh(), { status: 'in-flight' });
  assert.equal(supabase.calls.length, 1);
  resolveRequest({ data: { id: enrollmentId, status: 'ACTIVE' }, error: null });
  assert.deepEqual(await initial, { status: 'open', enrollmentStatus: 'ACTIVE' });
  monitor.stop();
  console.log('PASS overlapping status checks are deduplicated');
}

{
  const supabase = makeSupabase(() => ({ data: { id: enrollmentId, status: 'ACTIVE' }, error: null }));
  const scheduler = makeScheduler();
  const monitor = startEnrollmentLifecycleMonitor({
    supabase: supabase.client,
    enrollmentId,
    isReadOnly: () => true,
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule
  });
  assert.deepEqual(await monitor.initialCheck, { status: 'read-only' });
  assert.equal(supabase.calls.length, 0);
  assert.equal(monitor.stopped, true);
  console.log('PASS read-only logbooks do not start or continue enrollment polling');
}
