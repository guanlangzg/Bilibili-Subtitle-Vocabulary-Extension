const test = require('node:test');
const assert = require('node:assert/strict');

let sharedSettings = null;
let loadError = null;

try {
  sharedSettings = require('../sharedSettings.js');
} catch (error) {
  loadError = error;
}

test('shared settings: should expose defaults and scene presets', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  assert.deepEqual(sharedSettings.DEFAULT_SETTINGS.activeLevels, [
    'CET4',
    'CET6',
    'KAOYAN',
    'IELTS',
    'TOEFL',
  ]);
  assert.equal(sharedSettings.DEFAULT_SETTINGS.reviewDanmakuSpeed, 'normal');
  assert.equal(sharedSettings.DEFAULT_SETTINGS.reviewDanmakuDensity, 'normal');
  assert.deepEqual(sharedSettings.REVIEW_DENSITIES, ['sparse', 'normal', 'dense']);
  assert.deepEqual(sharedSettings.THEME_MODES, ['auto', 'light', 'dark']);
  assert.equal(sharedSettings.DEFAULT_SETTINGS.vocabularyMode, 'core');
  assert.equal(sharedSettings.DEFAULT_SETTINGS.examPreference, 'balanced');
  assert.deepEqual(sharedSettings.SCENE_PRESETS.light, {
    replaceRatio: 0.15,
    maxReplaceCount: 1,
    reviewDanmakuSpeed: 'slow',
    reviewDanmakuDensity: 'sparse',
  });
});

test('shared settings: should normalize invalid values into safe defaults', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  assert.deepEqual(
    sharedSettings.normalizeSettings({
      replaceRatio: 9,
      maxReplaceCount: -10,
      targetCefr: 'z9',
      reviewDanmakuSpeed: 'turbo',
      reviewDanmakuDensity: 'crowded',
      activeLevels: ['cet4', 'unknown', '', 'IELTS', 'cet4'],
    }),
    {
      enabled: true,
      reviewDanmakuEnabled: false,
      reviewDanmakuSpeed: 'normal',
      reviewDanmakuDensity: 'normal',
      vocabularyMode: 'core',
      examPreference: 'balanced',
      webPageEnabled: false,
      activeLevels: ['CET4', 'IELTS'],
      replaceRatio: 0.3,
      maxReplaceCount: 1,
      targetCefr: 'B2',
      bilingualMode: 'default',
      themeMode: 'auto',
      domainRules: {},
      schemaVersion: sharedSettings.SCHEMA_VERSION,
    }
  );
});

test('shared settings: should clamp zero values to lower bounds instead of default fallback', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const normalized = sharedSettings.normalizeSettings({
    replaceRatio: 0,
    maxReplaceCount: 0,
  });

  assert.equal(normalized.replaceRatio, 0.1);
  assert.equal(normalized.maxReplaceCount, 1);
});

test('shared settings: should expose bilingual mode label through shared helper', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  assert.equal(sharedSettings.getBilingualModeLabel('bilingual'), '双语对照');
});

test('shared settings: should fallback to default active levels when selection is empty', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  assert.deepEqual(
    sharedSettings.normalizeActiveLevels([]),
    sharedSettings.DEFAULT_SETTINGS.activeLevels
  );
});

test('shared settings: should normalize vocabulary mode and exam preference', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const normalized = sharedSettings.normalizeSettings({
    vocabularyMode: 'FULL',
    examPreference: 'exam-first',
  });
  assert.equal(normalized.vocabularyMode, 'full');
  assert.equal(normalized.examPreference, 'exam-first');

  const fallback = sharedSettings.normalizeSettings({
    vocabularyMode: 'unknown',
    examPreference: 'unknown',
  });
  assert.equal(fallback.vocabularyMode, 'core');
  assert.equal(fallback.examPreference, 'balanced');
});

test('shared settings: should derive preview copy and preset key from normalized settings', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const intensive = sharedSettings.normalizeSettings({
    enabled: true,
    replaceRatio: 0.3,
    maxReplaceCount: 4,
    targetCefr: 'C1',
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    activeLevels: ['TOEFL', 'IELTS'],
  });

  assert.equal(sharedSettings.getPresetKeyFromSettings(intensive), 'intensive');
  assert.equal(sharedSettings.getLearningProfile(intensive).tone, 'intensive');
  assert.match(sharedSettings.buildSettingsPreview(intensive), /30%/);
  assert.match(sharedSettings.buildSettingsPreview(intensive), /C1/);
  assert.match(sharedSettings.buildSettingsPreview(intensive), /高密度/);
});

test('shared settings: should normalize domain rules and evaluate current hostname', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const normalized = sharedSettings.normalizeSettings({
    domainRules: {
      'Example.COM': { enabled: false },
      'blog.example.com': { enabled: true, pausedUntil: 1893456000000 },
      '': { enabled: false },
      'invalid host': { enabled: false },
    },
  });

  assert.deepEqual(normalized.domainRules, {
    'example.com': { enabled: false },
    'blog.example.com': { enabled: true, pausedUntil: 1893456000000 },
  });

  assert.equal(sharedSettings.isDomainEnabled('example.com', normalized), false);
  assert.equal(sharedSettings.isDomainEnabled('blog.example.com', normalized), false);
  assert.equal(sharedSettings.isDomainEnabled('sub.blog.example.com', normalized), false);
  assert.equal(sharedSettings.isDomainEnabled('unknown.test', normalized), true);
});

test('shared settings: should set exact domain override when re-enabling a child hostname', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const pausedUntil = Date.now() + 60 * 1000;
  const domainRules = sharedSettings.setExactDomainRuleEnabled(
    {
      'example.com': { enabled: false },
      'video.example.com': { enabled: true, pausedUntil },
    },
    'video.example.com',
    true
  );

  assert.deepEqual(domainRules, {
    'example.com': { enabled: false },
    'video.example.com': { enabled: true },
  });
  assert.equal(
    sharedSettings.isDomainEnabled('video.example.com', {
      enabled: true,
      domainRules,
    }),
    true
  );
});

test('shared settings: should build storage payload from runtime baseline and form values', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const payload = sharedSettings.buildSettingsPayload(
    {
      enabled: true,
      reviewDanmakuEnabled: true,
      domainRules: {
        'example.com': { enabled: false },
      },
      schemaVersion: 999,
    },
    {
      enabled: false,
      replaceRatio: 0.29,
      activeLevels: ['cet4', 'unknown'],
    }
  );

  assert.equal(payload.enabled, false);
  assert.equal(payload.reviewDanmakuEnabled, true);
  assert.equal(payload.replaceRatio, 0.29);
  assert.deepEqual(payload.activeLevels, ['CET4']);
  assert.deepEqual(payload.domainRules, {
    'example.com': { enabled: false },
  });
  assert.equal(payload.schemaVersion, sharedSettings.SCHEMA_VERSION);
});

test('shared settings v3: should migrate legacy flat settings into v3 payload', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const migrated = sharedSettings.migrateToV3({
    enabled: true,
    replaceRatio: 0.25,
    maxReplaceCount: 4,
    targetCefr: 'c1',
    activeLevels: ['ielts', 'toefl'],
    bilingualMode: 'bilingual',
    themeMode: 'dark',
    reviewDanmakuDensity: 'dense',
    reviewDanmakuEnabled: true,
    webPageEnabled: false,
    domainRules: {
      'Example.COM': { enabled: false },
    },
    overlayPanelHidden: true,
    overlayPanelWidth: 999,
  });

  assert.equal(migrated.schemaVersion, sharedSettings.SCHEMA_VERSION_V3);
  assert.equal(migrated.globalControls.reviewDanmakuEnabled, true);
  assert.equal(migrated.globalControls.webPageEnabled, false);
  assert.deepEqual(migrated.globalControls.siteRules, {
    'example.com': { enabled: false },
  });
  assert.equal(migrated.globalControls.overlayState.hidden, true);
  assert.equal(migrated.globalControls.overlayState.width, 560);
  assert.equal(migrated.activeProfileId, 'legacy-imported');
  assert.equal(Array.isArray(migrated.profilesCustom), true);
  assert.equal(migrated.profilesCustom.length, 1);
  assert.equal(migrated.profilesCustom[0].config.bilingualMode, 'bilingual');
  assert.equal(migrated.profilesCustom[0].config.themeMode, 'dark');
  assert.equal(migrated.profilesCustom[0].config.reviewDanmakuDensity, 'dense');
});

test('shared settings v3: should resolve effective runtime by active profile and global controls', () => {
  assert.equal(
    loadError,
    null,
    loadError ? loadError.message : 'sharedSettings.js should be loadable'
  );

  const settingsV3 = sharedSettings.normalizeSettingsV3({
    activeProfileId: 'intensive',
    globalControls: {
      reviewDanmakuEnabled: true,
      webPageEnabled: true,
      siteRules: {
        'example.com': { enabled: false },
      },
    },
  });

  const runtimeBlocked = sharedSettings.resolveEffectiveRuntime(settingsV3, {
    hostname: 'example.com',
  });
  const runtimeAllowed = sharedSettings.resolveEffectiveRuntime(settingsV3, {
    hostname: 'video.test',
  });
  assert.equal(runtimeBlocked.reviewDanmakuEnabled, true);
  assert.equal(runtimeBlocked.maxReplaceCount, 4);
  assert.equal(runtimeBlocked.reviewDanmakuDensity, 'dense');
  assert.equal(runtimeBlocked.bilingualMode, 'default');
  assert.equal(runtimeBlocked.themeMode, 'auto');
  assert.equal(runtimeBlocked.siteEnabled, false);
  assert.equal(runtimeAllowed.siteEnabled, true);
});
