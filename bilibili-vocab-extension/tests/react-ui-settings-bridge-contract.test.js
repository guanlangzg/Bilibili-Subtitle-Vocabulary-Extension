const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'lib', 'settings-bridge.ts');
const BRIDGE_CORE_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'lib',
  'settings-bridge-core.ts'
);
const SHARED_SETTINGS_SOURCE_PATH = path.join(__dirname, '..', 'sharedSettings.js');
const FIXED_NOW = 1700000000000;

class FixedDate extends Date {
  static now() {
    return FIXED_NOW;
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function transpileTsModule(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadBridgeCoreModule(sandbox) {
  const coreCode = transpileTsModule(BRIDGE_CORE_SOURCE_PATH);
  const coreModuleRef = { exports: {} };
  const previousModule = sandbox.module;
  const previousExports = sandbox.exports;
  sandbox.module = coreModuleRef;
  sandbox.exports = coreModuleRef.exports;
  vm.runInNewContext(coreCode, sandbox, { filename: 'settings-bridge-core.js' });
  sandbox.module = previousModule;
  sandbox.exports = previousExports;
  return coreModuleRef.exports;
}

function createSettingsBridgeModule(options = {}) {
  const bridgeCode = transpileTsModule(SOURCE_PATH);
  const sharedCode = fs.readFileSync(SHARED_SETTINGS_SOURCE_PATH, 'utf8');

  const moduleRef = { exports: {} };
  const sharedModuleRef = { exports: {} };
  const sandbox = {
    module: options.withSharedSettings === false ? moduleRef : sharedModuleRef,
    exports: options.withSharedSettings === false ? moduleRef.exports : sharedModuleRef.exports,
    require(id) {
      if (id === './settings-normalizer') {
        return {};
      }
      if (id === './settings-bridge-core') {
        return loadBridgeCoreModule(sandbox);
      }
      return require(id);
    },
    console,
    Date: FixedDate,
    JSON,
    Math,
    Set,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  if (options.withSharedSettings !== false) {
    vm.runInNewContext(sharedCode, sandbox, { filename: 'sharedSettings.js' });
    sandbox.module = moduleRef;
    sandbox.exports = moduleRef.exports;
  }

  vm.runInNewContext(bridgeCode, sandbox, { filename: 'settings-bridge.js' });
  return {
    bridge: moduleRef.exports,
    sharedSettings: sharedModuleRef.exports,
  };
}

test('react settings bridge contract: should expose schema constants from SharedSettings', () => {
  const { bridge, sharedSettings } = createSettingsBridgeModule();

  assert.equal(bridge.SETTINGS_STORAGE_KEY_V3, sharedSettings.SETTINGS_STORAGE_KEY_V3);
  assert.deepEqual(bridge.BUILTIN_PROFILE_IDS, sharedSettings.BUILTIN_PROFILE_IDS);
  assert.equal(bridge.MAX_CUSTOM_PROFILES, sharedSettings.MAX_CUSTOM_PROFILES);
  assert.deepEqual(bridge.LEVELS, sharedSettings.LEVELS);
  assert.deepEqual(bridge.CEFR_LEVELS, sharedSettings.CEFR_LEVELS);
  assert.deepEqual(bridge.REVIEW_SPEEDS, sharedSettings.REVIEW_SPEEDS);
  assert.deepEqual(bridge.REVIEW_DENSITIES, sharedSettings.REVIEW_DENSITIES);
  assert.deepEqual(bridge.THEME_MODES, sharedSettings.THEME_MODES);
  assert.deepEqual(
    cloneValue(bridge.OVERLAY_DEFAULTS),
    cloneValue(sharedSettings.OVERLAY_DEFAULTS)
  );
  assert.deepEqual(cloneValue(bridge.SCENE_PRESETS), cloneValue(sharedSettings.SCENE_PRESETS));
});

test('react settings bridge contract: should delegate normalization and migration to SharedSettings', () => {
  const { bridge, sharedSettings } = createSettingsBridgeModule();
  const legacyPayload = {
    enabled: false,
    reviewDanmakuEnabled: true,
    webPageEnabled: false,
    domainRules: {
      'Docs.Example.com': { enabled: false },
    },
    activeLevels: ['ielts', 'unknown'],
    replaceRatio: 0.3,
    maxReplaceCount: 4,
    targetCefr: 'c1',
    bilingualMode: 'english-only',
    themeMode: 'dark',
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    vocabularyMode: 'full',
    examPreference: 'exam-first',
    overlayPanelHidden: true,
    overlayPanelWidth: 999,
  };
  const v3Payload = sharedSettings.migrateToV3(legacyPayload);

  assert.deepEqual(
    cloneValue(bridge.normalizeSettingsV3(v3Payload)),
    cloneValue(sharedSettings.normalizeSettingsV3(v3Payload))
  );
  assert.deepEqual(
    cloneValue(bridge.migrateToV3(legacyPayload)),
    cloneValue(sharedSettings.migrateToV3(legacyPayload))
  );
  assert.deepEqual(
    cloneValue(bridge.resolveEffectiveRuntime(v3Payload, 'docs.example.com')),
    cloneValue(sharedSettings.resolveEffectiveRuntime(v3Payload, { hostname: 'docs.example.com' }))
  );
  assert.deepEqual(
    cloneValue(bridge.normalizeDomainRules({ 'Docs.Example.com': { enabled: false } })),
    cloneValue(sharedSettings.normalizeDomainRules({ 'Docs.Example.com': { enabled: false } }))
  );
});

test('react settings bridge contract: should delegate display helpers to SharedSettings', () => {
  const { bridge, sharedSettings } = createSettingsBridgeModule();
  const profile = sharedSettings.normalizeProfileConfig({
    replaceRatio: 0.3,
    maxReplaceCount: 4,
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    bilingualMode: 'bilingual',
  });

  assert.equal(
    bridge.getReviewDanmakuSpeedLabel(profile.reviewDanmakuSpeed),
    sharedSettings.getReviewDanmakuSpeedLabel(profile.reviewDanmakuSpeed)
  );
  assert.equal(
    bridge.getReviewDanmakuDensityLabel(profile.reviewDanmakuDensity),
    sharedSettings.getReviewDanmakuDensityLabel(profile.reviewDanmakuDensity)
  );
  assert.equal(
    bridge.getBilingualModeLabel(profile.bilingualMode),
    sharedSettings.getBilingualModeLabel(profile.bilingualMode)
  );
  assert.deepEqual(
    bridge.getMockPreviewData(profile.targetCefr, 'bad-ratio', 'bad-count'),
    sharedSettings.getMockPreviewData(profile.targetCefr, 'bad-ratio', 'bad-count')
  );
  assert.deepEqual(
    cloneValue(bridge.getLearningProfile(profile)),
    cloneValue(sharedSettings.getLearningProfile(profile))
  );
  assert.equal(bridge.buildSettingsPreview(profile), sharedSettings.buildSettingsPreview(profile));
  assert.equal(
    bridge.getPresetKeyFromSettings(profile),
    sharedSettings.getPresetKeyFromSettings(profile)
  );
});

test('react settings bridge contract: should fail when SharedSettings is missing', () => {
  assert.throws(
    () => createSettingsBridgeModule({ withSharedSettings: false }),
    /SharedSettings is required before React settings bridge loads/
  );
});
