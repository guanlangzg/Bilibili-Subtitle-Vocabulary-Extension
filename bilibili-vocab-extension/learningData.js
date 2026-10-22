(function (globalScope) {
  const FORMAT = 'vocab-learning-data';
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'bili_vocab_learning_data_v1';
  const BOOK_CODES = ['CET4', 'CET6', 'KAOYAN', 'IELTS', 'TOEFL'];
  const SOURCES = ['extension', 'android'];
  const EVENT_TYPES = ['exposure', 'lookup', 'save', 'unsave', 'suspend', 'resume', 'review'];
  const RATINGS = ['again', 'hard', 'good', 'easy'];
  const STATES = ['new', 'learning', 'review', 'relearning', 'mastered'];
  const COUNTERS = ['exposureCount', 'lookupCount', 'reviewCount', 'saveCount'];
  const LEGACY_ALGORITHM = 'extension-interval';
  const LEGACY_ALGORITHM_VERSION = '1';

  function normalizeWord(word) {
    return String(word || '')
      .replace(
        /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g,
        ''
      )
      .toLowerCase();
  }

  // Java's nameUUIDFromBytes hashes the UTF-8 name directly, without a namespace.
  function wordId(word) {
    const bytes = new TextEncoder().encode(normalizeWord(word));
    const size = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(size);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(size - 8, (bytes.length * 8) >>> 0, true);
    view.setUint32(size - 4, Math.floor(bytes.length / 0x20000000), true);
    const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let offset = 0; offset < size; offset += 64) {
      let [a, b, c, d] = state;
      for (let i = 0; i < 64; i += 1) {
        const round = Math.floor(i / 16);
        let f;
        if (round === 0) f = (b & c) | (~b & d);
        else if (round === 1) f = (d & b) | (~d & c);
        else if (round === 2) f = b ^ c ^ d;
        else f = c ^ (b | ~d);
        const index = [i, (5 * i + 1) % 16, (3 * i + 5) % 16, (7 * i) % 16][round];
        const shift = shifts[round * 4 + (i % 4)];
        const sum =
          (a +
            f +
            Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) +
            view.getUint32(offset + index * 4, true)) |
          0;
        [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0, b, c];
      }
      [a, b, c, d].forEach((value, index) => {
        state[index] = (state[index] + value) | 0;
      });
    }
    const digest = new Uint8Array(16);
    const result = new DataView(digest.buffer);
    state.forEach((value, index) => result.setInt32(index * 4, value, true));
    digest[6] = (digest[6] & 15) | 48;
    digest[8] = (digest[8] & 63) | 128;
    const hex = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
    return `word-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function randomId() {
    if (!globalScope.crypto || typeof globalScope.crypto.randomUUID !== 'function') {
      throw new Error('Secure event identifiers unavailable');
    }
    return globalScope.crypto.randomUUID();
  }

  function text(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
    return value;
  }

  function number(value, field, nullable = false, integer = true) {
    if (nullable && value == null) return null;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      (integer && !Number.isSafeInteger(value)) ||
      (/(?:At)$/.test(field) && value > 8640000000000000)
    )
      throw new Error(`Invalid ${field}`);
    return value;
  }

  function count(value, field) {
    const result = number(value, field);
    if (result > 2147483647) throw new Error(`Invalid ${field}`);
    return result;
  }

  function choice(value, options, field) {
    if (!options.includes(value)) throw new Error(`Invalid ${field}`);
    return value;
  }

  function nullableText(value, field) {
    return value == null ? null : text(value, field);
  }

  function books(value) {
    if (!Array.isArray(value) || value.some((code) => !BOOK_CODES.includes(code))) {
      throw new Error('Invalid bookCodes');
    }
    return BOOK_CODES.filter((code) => value.includes(code));
  }

  function normalizeSchedule(value) {
    if (value == null) return null;
    const schedule = {
      algorithm: text(value.algorithm, 'algorithm'),
      algorithmVersion: text(value.algorithmVersion, 'algorithmVersion'),
      state: choice(value.state, STATES, 'state'),
      dueAt: number(value.dueAt, 'dueAt', true),
      lastReviewedAt: number(value.lastReviewedAt, 'lastReviewedAt', true),
      scheduledDays: count(value.scheduledDays, 'scheduledDays'),
      reviewCount: count(value.reviewCount, 'reviewCount'),
      lapseCount: count(value.lapseCount, 'lapseCount'),
      difficulty: number(value.difficulty, 'difficulty', true, false),
      stability: number(value.stability, 'stability', true, false),
      retrievability: number(value.retrievability, 'retrievability', true, false),
      targetRetention: number(value.targetRetention, 'targetRetention', true, false),
      legacyEaseFactor: number(value.legacyEaseFactor, 'legacyEaseFactor', true, false),
      legacyMasteryScore: number(value.legacyMasteryScore, 'legacyMasteryScore', true, false),
    };
    if (
      (schedule.targetRetention != null &&
        (schedule.targetRetention <= 0 || schedule.targetRetention >= 1)) ||
      (schedule.retrievability != null && schedule.retrievability > 1)
    )
      throw new Error('Invalid retention');
    return schedule;
  }

  function normalizeContext(value) {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid context');
    return {
      sentence: nullableText(value.sentence, 'sentence'),
      title: nullableText(value.title, 'title'),
      url: nullableText(value.url, 'url'),
      timeSeconds: number(value.timeSeconds, 'timeSeconds', true, false),
    };
  }

  function identity(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION)
      throw new Error('Unsupported learning schema');
    const word = text(value.word, 'word');
    if (word !== normalizeWord(word) || value.wordId !== wordId(word))
      throw new Error('Invalid word identity');
    return {
      schemaVersion: SCHEMA_VERSION,
      deviceId: text(value.deviceId, 'deviceId'),
      source: choice(value.source, SOURCES, 'source'),
      wordId: value.wordId,
      word,
    };
  }

  function normalizeEvent(value) {
    const base = identity(value);
    const type = choice(value.type, EVENT_TYPES, 'type');
    const occurredAt = number(value.occurredAt, 'occurredAt');
    const zoneId = text(value.zoneId, 'zoneId');
    if (!Number.isInteger(value.utcOffsetMinutes) || Math.abs(value.utcOffsetMinutes) > 1080) {
      throw new Error('Invalid utcOffsetMinutes');
    }
    const localDay = new Date(occurredAt + value.utcOffsetMinutes * 60000)
      .toISOString()
      .slice(0, 10);
    if (value.localDay !== localDay) throw new Error('Invalid localDay');
    const rating = type === 'review' ? choice(value.rating, RATINGS, 'rating') : null;
    if (type !== 'review' && value.rating != null) throw new Error('Only reviews have ratings');
    const algorithm = nullableText(value.algorithm, 'algorithm');
    const algorithmVersion = nullableText(value.algorithmVersion, 'algorithmVersion');
    if (type === 'review' && (!algorithm || !algorithmVersion))
      throw new Error('Missing review algorithm');
    if (type !== 'review' && (algorithm || algorithmVersion || value.targetRetention != null))
      throw new Error('Only reviews have scheduling parameters');
    const schedule = normalizeSchedule(value.schedule);
    if (
      schedule &&
      (type !== 'review' ||
        schedule.algorithm !== algorithm ||
        schedule.algorithmVersion !== algorithmVersion ||
        schedule.lastReviewedAt !== occurredAt)
    ) {
      throw new Error('Mismatched review schedule');
    }
    const targetRetention = number(value.targetRetention, 'targetRetention', true, false);
    if (targetRetention != null && (targetRetention <= 0 || targetRetention >= 1))
      throw new Error('Invalid targetRetention');
    return {
      ...base,
      eventId: text(value.eventId, 'eventId'),
      type,
      occurredAt,
      localDay,
      zoneId,
      utcOffsetMinutes: value.utcOffsetMinutes,
      bookCodes: books(value.bookCodes),
      rating,
      rawAction: nullableText(value.rawAction, 'rawAction'),
      durationMs: number(value.durationMs, 'durationMs', true),
      targetRetention,
      algorithm,
      algorithmVersion,
      context: normalizeContext(value.context),
      schedule,
    };
  }

  function normalizeBaseline(value) {
    const base = identity(value);
    if (typeof value.saved !== 'boolean' || typeof value.suspended !== 'boolean')
      throw new Error('Invalid baseline flags');
    const result = {
      ...base,
      baselineId: text(value.baselineId, 'baselineId'),
      capturedAt: number(value.capturedAt, 'capturedAt'),
      bookCodes: books(value.bookCodes),
      saved: value.saved,
      suspended: value.suspended,
      firstSeenAt: number(value.firstSeenAt, 'firstSeenAt', true),
      lastSeenAt: number(value.lastSeenAt, 'lastSeenAt', true),
      lastReviewedAt: number(value.lastReviewedAt, 'lastReviewedAt', true),
      schedule: normalizeSchedule(value.schedule),
    };
    COUNTERS.forEach((key) => {
      result[key] = count(value[key], key);
    });
    if (result.schedule && result.schedule.lastReviewedAt !== result.lastReviewedAt)
      throw new Error('Mismatched baseline schedule time');
    return result;
  }

  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function mergeRows(current, incoming, idKey, normalize) {
    const result = new Map();
    [...current, ...incoming].forEach((raw) => {
      const row = normalize(raw);
      const id = row[idKey];
      if (result.has(id) && canonical(result.get(id)) !== canonical(row))
        throw new Error(`Conflicting ${idKey}: ${id}`);
      result.set(id, row);
    });
    return Array.from(result.values()).sort((left, right) =>
      left[idKey] < right[idKey] ? -1 : left[idKey] > right[idKey] ? 1 : 0
    );
  }

  function mergeBaselines(current, incoming) {
    const rows = mergeRows(current, incoming, 'baselineId', normalizeBaseline);
    const identities = new Set();
    rows.forEach((row) => {
      const key = JSON.stringify([row.deviceId, row.wordId]);
      if (identities.has(key)) throw new Error('Duplicate device baseline');
      identities.add(key);
    });
    return rows;
  }

  function normalizeBundle(value) {
    if (
      !value ||
      value.format !== FORMAT ||
      value.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(value.events) ||
      !Array.isArray(value.baselines)
    )
      throw new Error('Unsupported learning data');
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: number(value.exportedAt, 'exportedAt'),
      events: mergeRows([], value.events, 'eventId', normalizeEvent),
      baselines: mergeBaselines([], value.baselines),
    };
  }

  function mergeBundles(current, incoming, exportedAt) {
    const left = normalizeBundle(current);
    const right = normalizeBundle(incoming);
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: number(exportedAt, 'exportedAt'),
      events: mergeRows(left.events, right.events, 'eventId', normalizeEvent),
      baselines: mergeBaselines(left.baselines, right.baselines),
    };
  }

  function createEvent(input) {
    const occurredAt = input.occurredAt == null ? Date.now() : input.occurredAt;
    const zoneId = input.zoneId || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const utcOffsetMinutes =
      input.utcOffsetMinutes == null
        ? -new Date(occurredAt).getTimezoneOffset()
        : input.utcOffsetMinutes;
    const word = normalizeWord(input.word);
    return normalizeEvent({
      ...input,
      schemaVersion: SCHEMA_VERSION,
      eventId: input.eventId || randomId(),
      word,
      wordId: wordId(word),
      occurredAt,
      zoneId,
      utcOffsetMinutes,
      localDay: new Date(occurredAt + utcOffsetMinutes * 60000).toISOString().slice(0, 10),
      bookCodes: input.bookCodes || [],
    });
  }

  function legacySchedule(record) {
    if (record.schedule) return normalizeSchedule(record.schedule);
    return normalizeSchedule({
      algorithm: LEGACY_ALGORITHM,
      algorithmVersion: LEGACY_ALGORITHM_VERSION,
      state: record.status === 'mastered' ? 'mastered' : record.reviewCount > 0 ? 'review' : 'new',
      dueAt: record.nextReviewAt || null,
      lastReviewedAt: record.lastReviewedAt || null,
      scheduledDays: record.intervalDays || 1,
      reviewCount: record.reviewCount || 0,
      lapseCount: 0,
      legacyEaseFactor: record.easeFactor || null,
      legacyMasteryScore: record.masteryScore || 0,
    });
  }

  function createBaseline(record, deviceId, capturedAt) {
    const word = normalizeWord(record.word);
    const id = wordId(word);
    const schedule = legacySchedule(record);
    return normalizeBaseline({
      schemaVersion: SCHEMA_VERSION,
      baselineId: `legacy|${deviceId}|${id}`,
      deviceId,
      source: 'extension',
      wordId: id,
      word,
      capturedAt,
      bookCodes: (record.sourceLevels || [record.level]).filter((code) =>
        BOOK_CODES.includes(code)
      ),
      exposureCount: record.exposureCount ?? record.hitCount ?? 0,
      lookupCount: record.lookupCount ?? 0,
      reviewCount: record.reviewCount ?? schedule.reviewCount,
      saveCount: record.saveCount ?? 0,
      firstSeenAt: record.firstSeenAt ?? null,
      lastSeenAt: record.lastSeenAt ?? record.lastSeen ?? null,
      lastReviewedAt: record.lastReviewedAt ?? schedule.lastReviewedAt,
      saved: record.saved ?? record.status === 'saved',
      suspended: record.suspended ?? record.status === 'skipped',
      schedule,
    });
  }

  function deriveProgress(bundle) {
    const data = normalizeBundle(bundle);
    const result = {};
    const clocks = {};
    function get(row) {
      if (!result[row.wordId]) {
        const contributions = {};
        SOURCES.forEach((source) => {
          contributions[source] = Object.fromEntries(COUNTERS.map((key) => [key, 0]));
        });
        result[row.wordId] = {
          wordId: row.wordId,
          word: row.word,
          bookCodes: [],
          ...Object.fromEntries(COUNTERS.map((key) => [key, 0])),
          saved: false,
          suspended: false,
          firstSeenAt: null,
          lastSeenAt: null,
          lastReviewedAt: null,
          schedule: null,
          contributions,
        };
        clocks[row.wordId] = { saved: [-1, ''], suspended: [-1, ''], schedule: [-1, ''] };
      }
      const progress = result[row.wordId];
      progress.bookCodes = books([...progress.bookCodes, ...row.bookCodes]);
      return progress;
    }
    function updateFlag(progress, field, value, at, id) {
      const previous = clocks[progress.wordId][field];
      if (at > previous[0] || (at === previous[0] && id > previous[1])) {
        progress[field] = value;
        clocks[progress.wordId][field] = [at, id];
      }
    }
    function updateTimes(progress, first, last, reviewed) {
      if (first != null)
        progress.firstSeenAt =
          progress.firstSeenAt == null ? first : Math.min(progress.firstSeenAt, first);
      if (last != null) progress.lastSeenAt = Math.max(progress.lastSeenAt || 0, last);
      if (reviewed != null)
        progress.lastReviewedAt = Math.max(progress.lastReviewedAt || 0, reviewed);
    }
    data.baselines.forEach((row) => {
      const progress = get(row);
      COUNTERS.forEach((key) => {
        progress[key] = number(progress[key] + row[key], key);
        progress.contributions[row.source][key] = number(
          progress.contributions[row.source][key] + row[key],
          key
        );
      });
      updateTimes(progress, row.firstSeenAt, row.lastSeenAt, row.lastReviewedAt);
      // A missing legacy flag cannot cancel an explicit action on another device.
      if (row.saved) updateFlag(progress, 'saved', true, 0, `0|${row.baselineId}`);
      if (row.suspended) updateFlag(progress, 'suspended', true, 0, `0|${row.baselineId}`);
      if (row.schedule)
        updateFlag(
          progress,
          'schedule',
          row.schedule,
          row.schedule.lastReviewedAt || 0,
          `0|${row.baselineId}`
        );
    });
    data.events.forEach((row) => {
      const progress = get(row);
      const key = {
        exposure: 'exposureCount',
        lookup: 'lookupCount',
        review: 'reviewCount',
        save: 'saveCount',
      }[row.type];
      if (key) {
        progress[key] = number(progress[key] + 1, key);
        progress.contributions[row.source][key] = number(
          progress.contributions[row.source][key] + 1,
          key
        );
      }
      if (row.type === 'exposure' || row.type === 'lookup')
        updateTimes(progress, row.occurredAt, row.occurredAt, null);
      if (row.type === 'review') {
        updateTimes(progress, null, null, row.occurredAt);
        if (row.schedule)
          updateFlag(progress, 'schedule', row.schedule, row.occurredAt, `1|${row.eventId}`);
      }
      if (row.type === 'save' || row.type === 'unsave')
        updateFlag(progress, 'saved', row.type === 'save', row.occurredAt, `1|${row.eventId}`);
      if (row.type === 'suspend' || row.type === 'resume')
        updateFlag(
          progress,
          'suspended',
          row.type === 'suspend',
          row.occurredAt,
          `1|${row.eventId}`
        );
    });
    return result;
  }

  const api = {
    FORMAT,
    SCHEMA_VERSION,
    STORAGE_KEY,
    BOOK_CODES,
    RATINGS,
    EVENT_TYPES,
    LEGACY_ALGORITHM,
    LEGACY_ALGORITHM_VERSION,
    normalizeWord,
    wordId,
    randomId,
    normalizeSchedule,
    normalizeEvent,
    normalizeBaseline,
    normalizeBundle,
    mergeBundles,
    createEvent,
    createBaseline,
    legacySchedule,
    deriveProgress,
    canonical,
  };
  globalScope.LearningData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
