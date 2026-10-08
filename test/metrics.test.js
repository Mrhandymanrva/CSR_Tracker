import test from 'node:test';
import assert from 'node:assert/strict';
import { businessMinutes, callMeasures, leadTouchMinutes, estimateMeasures, jobMeasures, overdueTasks, overdueFollowUps, monthlyInputs, revenue, bookingQueue, weeklyValues, ESTIMATE_JOB_TYPE_ID } from '../src/metrics.js';

// October 2026 is EDT (UTC-4). Mon 2026-10-05 09:00 EDT = 13:00Z.
const t = (day, hhmm) => `2026-10-${String(day).padStart(2, '0')}T${hhmm}:00Z`;
const ms = (s) => Date.parse(s);

test('business minutes: within a day, across close/open, across a weekend, outside hours', () => {
  assert.equal(businessMinutes(ms(t(5, '13:00')), ms(t(5, '13:04'))), 4);
  assert.equal(businessMinutes(ms(t(9, '20:58')), ms(t(12, '12:02'))), 4); // Fri 16:58 -> Mon 08:02 EDT
  assert.equal(businessMinutes(ms(t(10, '15:00')), ms(t(11, '15:00'))), 0); // Sat -> Sun
  assert.equal(businessMinutes(ms(t(5, '02:00')), ms(t(5, '11:00'))), 0); // 22:00 Sun .. 07:00 Mon EDT
  assert.equal(businessMinutes(ms(t(5, '13:00')), ms(t(5, '13:00'))), 0);
});

test('business minutes respects DST change (Nov 2026 is EST, UTC-5)', () => {
  // Mon 2026-11-02 08:00 EST = 13:00Z
  assert.equal(businessMinutes(ms('2026-11-02T13:00:00Z'), ms('2026-11-02T13:30:00Z')), 30);
});

const call = (o) => ({ leadCall: { id: Math.random(), ...o } });

test('missed calls: returned vs unreturned past grace, matched by customer or phone', () => {
  const now = ms(t(5, '17:00')); // 13:00 EDT
  const calls = [
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '+18045550101', customer: { id: 1 } }), // returned by customer id in 3 min
    call({ receivedOn: t(5, '13:03'), direction: 'Outbound', to: '+18045559999', customer: { id: 1 } }),
    call({ receivedOn: t(5, '13:10'), direction: 'Inbound', callType: 'Abandoned', from: '(804) 555-0102' }), // returned by phone in 6 min
    call({ receivedOn: t(5, '13:16'), direction: 'Outbound', to: '8045550102' }),
    call({ receivedOn: t(5, '14:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550103' }), // 3h unreturned
    call({ receivedOn: t(5, '16:30'), direction: 'Inbound', callType: 'Abandoned', from: '8045550104' }), // 30 min: inside grace
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Booked', from: '8045550105' }), // not missed
  ];
  const r = callMeasures(calls, now, undefined, new Set(['8045550103'])); // 0103 is a known lead number
  assert.equal(r.missedCalls, 4);
  assert.equal(r.callers, 4);
  assert.deepEqual(r.waiting, { identified: 1, repeat: 0, unidentified: 0, counted: 1 });
  assert.equal(r.unreturnedOverdue, 1);
  assert.deepEqual(r.touches.sort((a, b) => a - b), [3, 6]);
});

test('missed calls are counted per caller; unidentified singles are shown but not counted; repeat callers are promoted', () => {
  const now = ms(t(5, '20:00'));
  const calls = [
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550201' }), // unknown, single -> unidentified
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550202' }), // unknown, calls twice same day -> repeat
    call({ receivedOn: t(5, '15:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550202' }),
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550203', customer: { id: 9 } }), // customer record -> identified, 3 attempts = 1 caller
    call({ receivedOn: t(5, '14:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550203', customer: { id: 9 } }),
    call({ receivedOn: t(5, '15:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550203', customer: { id: 9 } }),
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550204' }), // unknown, two attempts on different days -> unidentified
    call({ receivedOn: t(6, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550204' }),
  ];
  const r = callMeasures(calls, now);
  assert.equal(r.missedCalls, 8);
  assert.equal(r.callers, 4);
  assert.deepEqual(r.waiting, { identified: 1, repeat: 1, unidentified: 2, counted: 2 });
  assert.equal(r.unreturnedOverdue, 2);
});

test('lead first touch uses first outbound call to the customer after creation', () => {
  const calls = [call({ receivedOn: t(5, '12:50'), direction: 'Outbound', customer: { id: 7 } }), call({ receivedOn: t(5, '13:05'), direction: 'Outbound', customer: { id: 7 } }), call({ receivedOn: t(5, '13:09'), direction: 'Outbound', customer: { id: 7 } })];
  assert.deepEqual(leadTouchMinutes([{ createdOn: t(5, '13:00'), customerId: 7 }, { createdOn: t(5, '13:00'), customerId: 8 }, { createdOn: t(5, '13:00') }], calls), [5]);
});

test('estimate conversion counts decisions in the period; awaiting booking matches work jobs by customer', () => {
  const w = { from: ms(t(1, '00:00')), to: ms(t(8, '00:00')) };
  const estimates = [
    { id: 1, customerId: 1, status: { name: 'Sold' }, soldOn: t(2, '15:00'), createdOn: '2026-09-01T00:00:00Z', subtotal: '1000.50' },
    { id: 2, customerId: 2, status: { name: 'Sold' }, soldOn: t(3, '15:00'), createdOn: t(2, '10:00'), subtotal: 500 },
    { id: 3, customerId: 3, status: { name: 'Dismissed' }, modifiedOn: t(3, '15:00'), createdOn: t(2, '10:00'), subtotal: 900 },
    { id: 4, customerId: 4, status: { name: 'Open' }, createdOn: t(4, '15:00'), subtotal: 100 },
    { id: 5, customerId: 5, status: { name: 'Sold' }, soldOn: '2026-08-01T15:00:00Z', createdOn: '2026-08-01T10:00:00Z', subtotal: 1 }, // old sale, still no work job
    { id: 6, customerId: 6, status: { name: 'Dismissed' }, modifiedOn: '2026-08-05T15:00:00Z', createdOn: '2026-08-01T10:00:00Z', subtotal: 1 }, // old decision
  ];
  const jobs = [
    { id: 10, customerId: 1, jobTypeId: 5, jobStatus: 'Scheduled', createdOn: t(3, '12:00') }, // work booked for customer 1
    { id: 11, customerId: 2, jobTypeId: ESTIMATE_JOB_TYPE_ID, jobStatus: 'Completed', createdOn: t(3, '12:00') }, // estimate job does not count
    { id: 12, customerId: 5, jobTypeId: 5, jobStatus: 'Canceled', createdOn: '2026-08-02T12:00:00Z' }, // canceled does not count
  ];
  const r = estimateMeasures(estimates, jobs, w);
  assert.equal(r.sold, 2); assert.equal(r.dismissed, 1);
  assert.equal(r.conversion, 2 / 3);
  assert.equal(r.soldDollars, 1500.5);
  assert.equal(r.acceptedAwaitingBooking, 2); // customers 2 and 5
  assert.equal(estimateMeasures([], [], w).conversion, null);
});

test('missed call is resolved when the caller later connects inbound', () => {
  const now = ms(t(5, '20:00'));
  const calls = [
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550111' }),
    call({ receivedOn: t(5, '13:20'), direction: 'Inbound', callType: 'Booked', from: '8045550111' }),
    call({ receivedOn: t(5, '13:00'), direction: 'Inbound', callType: 'Abandoned', from: '8045550112' }),
  ];
  const r = callMeasures(calls, now);
  assert.equal(r.waiting.unidentified, 1); // 0112 still waiting; 0111 reached us again so is resolved
  assert.equal(r.unreturnedOverdue, 0);
  assert.equal(callMeasures(calls, now, undefined, new Set(['8045550112'])).unreturnedOverdue, 1);
});

test('revenue parses string money from ServiceTitan', () => {
  assert.equal(revenue([{ invoiceDate: t(2, '12:00'), total: '1646.72' }, { invoiceDate: t(3, '12:00'), total: '53.28' }], { from: ms(t(1, '00:00')), to: ms(t(8, '00:00')) }), 1700);
});

test('jobs: bookings exclude estimate type and canceled; van-rolls are $0 non-canceled', () => {
  const w = { from: ms(t(1, '00:00')), to: ms(t(8, '00:00')) };
  const jobs = [
    { id: 1, createdOn: t(2, '15:00'), jobStatus: 'Completed', jobTypeId: 1, total: 400 },
    { id: 2, createdOn: t(2, '15:00'), jobStatus: 'Scheduled', jobTypeId: 1, total: 0 },
    { id: 3, createdOn: t(2, '15:00'), jobStatus: 'Completed', jobTypeId: ESTIMATE_JOB_TYPE_ID, total: 0 },
    { id: 4, createdOn: t(2, '15:00'), jobStatus: 'Canceled', jobTypeId: 1, total: 0 },
    { id: 5, createdOn: t(2, '15:00'), jobStatus: 'Completed', jobTypeId: ESTIMATE_JOB_TYPE_ID, total: 150 },
    { id: 6, createdOn: '2026-08-01T15:00:00Z', jobStatus: 'Completed', jobTypeId: 1, total: 9999 },
  ];
  const r = jobMeasures(jobs, w);
  assert.equal(r.netBookings, 400);
  assert.equal(r.vanRollsWithoutCommitment, 1); // only the completed $0 estimate job; the scheduled $0 job is not invoiced yet
  assert.equal(r.jobsCreated, 4);
});

test('overdue tasks, revenue window, booking queue', () => {
  const now = ms(t(5, '17:00'));
  assert.equal(overdueTasks([{ isClosed: false, completeBy: t(4, '12:00') }, { isClosed: true, completeBy: t(4, '12:00') }, { isClosed: false, completeBy: t(6, '12:00') }, { isClosed: false }], now), 1);
  assert.equal(revenue([{ invoiceDate: t(2, '12:00'), total: 100 }, { invoiceDate: t(9, '12:00'), total: 50 }, { invoiceDate: t(3, '12:00'), total: 25, active: false }], { from: ms(t(1, '00:00')), to: ms(t(8, '00:00')) }), 100);
  const q = bookingQueue([{ status: 'New', source: 'Web Chat', createdOn: t(5, '12:00') }, { status: 'New', source: 'AngiAds', createdOn: t(5, '12:00') }, { status: 'Dismissed', source: 'Web Chat', createdOn: t(5, '12:00') }], now);
  assert.deepEqual(q, { newBookings: 2, newWebChats: 1 });
});

test('follow-ups: open leads past due plus open estimates older than the window', () => {
  const now = ms(t(10, '12:00'));
  const leads = [
    { status: 'Open', followUpDate: t(8, '12:00') }, // overdue
    { status: 'Open', followUpDate: t(12, '12:00') }, // future
    { status: 'Dismissed', followUpDate: t(1, '12:00') }, // not open
    { status: 'Open' }, // no date: not counted
  ];
  const estimates = [
    { status: { name: 'Open' }, createdOn: t(5, '12:00') }, // 5d old: overdue at 3d window
    { status: { name: 'Open' }, createdOn: t(9, '12:00') }, // 1d old
    { status: { name: 'Sold' }, createdOn: t(1, '12:00') },
  ];
  assert.deepEqual(overdueFollowUps(leads, estimates, now), { leads: 1, estimates: 1, total: 2 });
  assert.equal(overdueFollowUps(leads, estimates, now, { estimateFollowUpDays: 10 }).estimates, 0);
});

test('monthly inputs: bookings = sold estimates + non-estimate job totals; revenue from invoices', () => {
  const w = { from: ms(t(1, '00:00')), to: ms(t(31, '00:00')) };
  const data = {
    estimates: [{ status: { name: 'Sold' }, soldOn: t(3, '12:00'), subtotal: 1000, customerId: 1 }],
    jobs: [{ createdOn: t(4, '12:00'), jobStatus: 'Completed', jobTypeId: 5, total: '250.25', customerId: 1 }, { createdOn: t(4, '12:00'), jobStatus: 'Completed', jobTypeId: ESTIMATE_JOB_TYPE_ID, total: 0 }],
    invoices: [{ invoiceDate: t(5, '12:00'), total: '800' }],
  };
  assert.deepEqual(monthlyInputs(data, w), { bookingsActual: 1250.25, soldEstimateDollars: 1000, jobDollars: 250.25, revenueActual: 800 });
});

test('weeklyValues leaves undefined measures null instead of guessing', () => {
  const v = weeklyValues({ calls: [], leads: [], estimates: [], jobs: [], tasks: [] }, { from: 0, to: 1 }, ms(t(5, '17:00')));
  assert.equal(v.firstTouch, null); assert.equal(v.estimateConversion, null);
  assert.equal(v.handoffMisses, null); assert.equal(v.routingAccuracy, null); assert.equal(v.estimateTurnaround, null);
  assert.equal(v.missedCalls, 0);
});
