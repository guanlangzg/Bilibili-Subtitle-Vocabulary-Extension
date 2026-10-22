const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('../learningData.js');
const fixture = require('./fixtures/learning-data-v1.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function empty() {
  return { format: data.FORMAT, schemaVersion: 1, exportedAt: 0, events: [], baselines: [] };
}

function expectedWordId(word) {
  const hash = createHash('md5').update(word.trim().toLowerCase(), 'utf8').digest();
  hash[6] = (hash[6] & 15) | 48;
  hash[8] = (hash[8] & 63) | 128;
  const hex = hash.toString('hex');
  return `word-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

test('learning data: word identity matches Java nameUUIDFromBytes, including UTF-8 and long names', () => {
  for (const word of [
    'state',
    ' Abandon ',
    'Café',
    '中文',
    '😀',
    'x'.repeat(80),
    'A-B',
    'a b',
    '\ufeffstate\ufeff',
    '\u3000state\u3000',
    '\u0085state\u0085',
    '\u001cstate\u001c',
    'İ',
    'ΟΣ',
  ]) {
    assert.equal(data.wordId(word), expectedWordId(word));
  }
  assert.equal(data.wordId('state'), 'word-9ed39e2e-a931-386b-aa98-5a6942ef573e');
  assert.equal(data.wordId('abandon'), 'word-b0bbb221-8aa3-3788-82a8-ed8c78aa2cae');
});

test('learning data: browser module needs no Node APIs or third party dependencies', () => {
  const context = { TextEncoder, Uint8Array, DataView, console };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'learningData.js'), 'utf8'),
    context
  );
  assert.equal(context.LearningData.wordId('state'), expectedWordId('state'));
});

test('learning data: shared fixture preserves both sources, per-word progress and nullable fields', () => {
  const bundle = data.normalizeBundle(fixture);
  assert.deepEqual(bundle, fixture);
  const progress = data.deriveProgress(bundle);
  assert.equal(Object.keys(progress).length, 1);
  const state = progress[data.wordId('state')];
  assert.deepEqual(state.bookCodes, ['CET4', 'CET6']);
  assert.deepEqual(
    [state.exposureCount, state.lookupCount, state.reviewCount, state.saveCount],
    [8, 2, 3, 1]
  );
  assert.equal(state.saved, false);
  assert.equal(state.suspended, false);
  assert.equal(state.firstSeenAt, 1767139200000);
  assert.equal(state.lastSeenAt, 1767225603000);
  assert.equal(state.lastReviewedAt, 1767225602000);
  assert.equal(state.schedule.algorithm, 'fsrs');
  assert.equal(state.schedule.legacyEaseFactor, null);
  assert.deepEqual(state.contributions, {
    extension: { exposureCount: 8, lookupCount: 2, reviewCount: 2, saveCount: 1 },
    android: { exposureCount: 0, lookupCount: 0, reviewCount: 1, saveCount: 0 },
  });
});

test('learning data: repeated, reordered and round trip imports are idempotent', () => {
  const initial = data.mergeBundles(empty(), fixture, fixture.exportedAt);
  const reversed = clone(fixture);
  reversed.events.reverse();
  reversed.events.push(clone(reversed.events[0]));
  const merged = data.mergeBundles(initial, reversed, fixture.exportedAt);
  assert.deepEqual(merged, initial);
  const roundTrip = data.mergeBundles(
    initial,
    JSON.parse(JSON.stringify(merged)),
    fixture.exportedAt
  );
  assert.deepEqual(roundTrip, initial);
  assert.deepEqual(data.deriveProgress(roundTrip), data.deriveProgress(fixture));
});

test('learning data: an identifier conflict rejects the entire bundle without mutating originals', () => {
  const original = clone(fixture);
  const conflict = clone(fixture);
  conflict.events[1].rating = 'again';
  assert.throws(
    () => data.mergeBundles(fixture, conflict, fixture.exportedAt),
    /Conflicting eventId/
  );
  const baselineConflict = clone(fixture);
  baselineConflict.baselines[0].exposureCount += 1;
  assert.throws(
    () => data.mergeBundles(fixture, baselineConflict, fixture.exportedAt),
    /Conflicting baselineId/
  );
  assert.deepEqual(fixture, original);
});

test('learning data: simultaneous reviews on different devices both contribute once', () => {
  const bundle = clone(fixture);
  const event = clone(bundle.events[1]);
  event.eventId = '55555555-5555-4555-8555-555555555555';
  event.source = 'extension';
  event.deviceId = bundle.events[0].deviceId;
  event.algorithm = 'extension-interval';
  event.algorithmVersion = '1';
  event.schedule = data.legacySchedule({ reviewCount: 3, lastReviewedAt: event.occurredAt });
  bundle.events.push(event);
  const state = data.deriveProgress(bundle)[data.wordId('state')];
  assert.equal(state.reviewCount, 4);
  assert.equal(state.contributions.extension.reviewCount, 3);
  assert.equal(state.contributions.android.reviewCount, 1);
  assert.equal(state.schedule.algorithm, 'extension-interval');
});

test('learning data: same-instant actions supersede legacy flags and retain independent schedule', () => {
  const bundle = clone(fixture);
  bundle.baselines[0].capturedAt = bundle.events[2].occurredAt;
  bundle.baselines[0].baselineId = 'zzzz-baseline';
  const state = data.deriveProgress(bundle)[data.wordId('state')];
  assert.equal(state.saved, false);
  assert.equal(state.schedule.algorithm, 'fsrs');
  const later = data.createEvent({
    ...bundle.events[2],
    eventId: '66666666-6666-4666-8666-666666666666',
    type: 'suspend',
    occurredAt: fixture.exportedAt + 1,
  });
  bundle.events.push(later);
  const next = data.deriveProgress(bundle)[data.wordId('state')];
  assert.equal(next.suspended, true);
  assert.equal(next.reviewCount, 3);
  assert.equal(next.schedule.dueAt, state.schedule.dueAt);
});

test('learning data: migrations keep aggregate history as a baseline without invented reviews', () => {
  const baseline = data.createBaseline(
    {
      word: ' State ',
      exposureCount: 9,
      lookupCount: 3,
      reviewCount: 4,
      saveCount: 1,
      status: 'saved',
      sourceLevels: ['CET6', 'CET4'],
      lastReviewedAt: 1767139200000,
      nextReviewAt: 1767312000000,
      intervalDays: 2,
      easeFactor: 2.3,
      masteryScore: 60,
    },
    'device-test',
    fixture.exportedAt
  );
  const bundle = { ...empty(), baselines: [baseline] };
  const state = data.deriveProgress(bundle)[data.wordId('state')];
  assert.equal(bundle.events.length, 0);
  assert.equal(state.reviewCount, 4);
  assert.equal(state.saved, true);
  assert.equal(state.schedule.algorithm, 'extension-interval');
  assert.equal(state.schedule.stability, null);
  assert.equal(state.schedule.legacyMasteryScore, 60);
});

test('learning data: unknown words survive export, independently of installed vocabulary files', () => {
  const event = data.createEvent({
    ...fixture.events[0],
    eventId: 'unknown-word-event',
    word: 'out-of-dataset',
  });
  const bundle = data.mergeBundles(empty(), { ...empty(), events: [event] }, fixture.exportedAt);
  assert.equal(data.deriveProgress(bundle)[data.wordId('out-of-dataset')].exposureCount, 1);
});

test('learning data: event IDs are generated once and use secure independent UUIDs', () => {
  const a = data.createEvent({ ...fixture.events[0], eventId: undefined });
  const b = data.createEvent({ ...fixture.events[0], eventId: undefined });
  assert.match(a.eventId, /^[0-9a-f-]{14}4[0-9a-f-]{21}$/);
  assert.notEqual(a.eventId, b.eventId);
  assert.equal(data.normalizeEvent(a).eventId, a.eventId);
});

test('learning data: strict schema, identity, dates, numeric values and review semantics', () => {
  for (const mutate of [
    (x) => {
      x.schemaVersion = 2;
    },
    (x) => {
      x.word = 'STATE';
    },
    (x) => {
      x.wordId = data.wordId('other');
    },
    (x) => {
      x.occurredAt = '1767225602000';
    },
    (x) => {
      x.occurredAt = Number.MAX_SAFE_INTEGER + 1;
    },
    (x) => {
      x.localDay = '2026-01-01';
    },
    (x) => {
      x.utcOffsetMinutes = 9999;
    },
    (x) => {
      x.bookCodes = ['UNKNOWN'];
    },
    (x) => {
      x.rating = 'know';
    },
    (x) => {
      x.durationMs = -1;
    },
    (x) => {
      x.targetRetention = 0;
    },
    (x) => {
      x.schedule.algorithm = 'extension-interval';
    },
    (x) => {
      x.schedule.stability = -2;
    },
  ]) {
    const event = clone(fixture.events[1]);
    mutate(event);
    assert.throws(() => data.normalizeEvent(event));
  }
  const invalidExposure = { ...clone(fixture.events[0]), rating: 'good' };
  assert.throws(() => data.normalizeEvent(invalidExposure), /Only reviews have ratings/);
  assert.throws(() => data.normalizeBundle({ ...empty(), schemaVersion: 5 }), /Unsupported/);
});

test('learning data: duplicate device baselines and overflowing counters are rejected', () => {
  const duplicate = clone(fixture);
  duplicate.baselines.push({ ...duplicate.baselines[0], baselineId: 'different-baseline' });
  assert.throws(() => data.normalizeBundle(duplicate), /Duplicate device baseline/);
  const overflow = clone(fixture);
  overflow.baselines[0].exposureCount = Number.MAX_SAFE_INTEGER;
  assert.throws(() => data.deriveProgress(overflow), /Invalid exposureCount/);
  const noReview = clone(fixture.events[0]);
  noReview.algorithm = 'fsrs';
  assert.throws(() => data.normalizeEvent(noReview), /Only reviews have scheduling/);
  const badSnapshot = clone(fixture.events[1]);
  badSnapshot.schedule.lastReviewedAt -= 1;
  assert.throws(() => data.normalizeEvent(badSnapshot), /Mismatched review schedule/);
});

test('learning data: unknown legacy flags never cancel explicit actions from another device', () => {
  const bundle = clone(fixture);
  bundle.events = bundle.events.filter((event) => event.type !== 'unsave');
  const baseline = {
    ...clone(bundle.baselines[0]),
    deviceId: fixture.events[1].deviceId,
    source: 'android',
    baselineId: 'android-baseline',
    capturedAt: fixture.exportedAt + 1000,
    saved: false,
    exposureCount: 0,
    lookupCount: 0,
    reviewCount: 0,
    saveCount: 0,
  };
  bundle.baselines.push(baseline);
  assert.equal(data.deriveProgress(bundle)[data.wordId('state')].saved, true);
  bundle.events.push(clone(fixture.events[2]));
  bundle.baselines[0].capturedAt = fixture.exportedAt + 2000;
  assert.equal(data.deriveProgress(bundle)[data.wordId('state')].saved, false);
});

test('learning data: per-row counters use Int32 and cross-device totals remain wider', () => {
  const bundle = clone(fixture);
  bundle.baselines[0].exposureCount = 2147483647;
  bundle.baselines.push({
    ...clone(bundle.baselines[0]),
    deviceId: fixture.events[1].deviceId,
    baselineId: 'android-counter-baseline',
    source: 'android',
  });
  assert.equal(data.deriveProgress(bundle)[data.wordId('state')].exposureCount, 4294967295);
  bundle.baselines[1].exposureCount += 1;
  assert.throws(() => data.normalizeBundle(bundle), /Invalid exposureCount/);
});

test('learning data: baseline snapshots have a single consistent review time', () => {
  const invalid = clone(fixture.baselines[0]);
  invalid.schedule.lastReviewedAt += 1;
  assert.throws(() => data.normalizeBaseline(invalid), /Mismatched baseline schedule time/);
  const schedule = clone(fixture.events[1].schedule);
  const migrated = data.createBaseline(
    { word: 'state', schedule },
    'schedule-only-device',
    fixture.exportedAt
  );
  assert.equal(migrated.reviewCount, schedule.reviewCount);
  assert.equal(migrated.lastReviewedAt, schedule.lastReviewedAt);
  for (const context of [[], 'invalid', 10]) {
    assert.throws(() => data.normalizeEvent({ ...fixture.events[0], context }), /Invalid context/);
  }
});

test('learning data: local calendar day is preserved across UTC midnight', () => {
  const review = data.normalizeEvent(fixture.events[1]);
  assert.equal(review.localDay, '2025-12-31');
  assert.equal(new Date(review.occurredAt).toISOString().slice(0, 10), '2026-01-01');
  assert.equal(review.utcOffsetMinutes, -480);
});
