const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SOURCE_PATH = path.join(__dirname, '..', 'react-ui', 'src', 'lib', 'overlay-settings.ts');
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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

class FixedDate extends Date {
  static now() {
    return FIXED_NOW;
  }
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

function createOverlaySettingsModule() {
  const sharedCode = fs.readFileSync(SHARED_SETTINGS_SOURCE_PATH, 'utf8');
  const overlayCode = transpileTsModule(SOURCE_PATH);

  const moduleRef = { exports: {} };
  const sharedModuleRef = { exports: {} };
  const sandbox = {
    module: sharedModuleRef,
    exports: sharedModuleRef.exports,
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

  vm.runInNewContext(sharedCode, sandbox, { filename: 'sharedSettings.js' });
  sandbox.module = moduleRef;
  sandbox.exports = moduleRef.exports;
  vm.runInNewContext(overlayCode, sandbox, { filename: 'overlay-settings.js' });

  return {
    overlaySettings: moduleRef.exports,
    sharedSettings: sharedModuleRef.exports,
  };
}

test('react overlay settings contract: should delegate overlay panel bounds to SharedSettings', () => {
  const { overlaySettings, sharedSettings } = createOverlaySettingsModule();
  const payload = {
    globalControls: {
      overlayState: {
        hidden: true,
        collapsed: false,
        width: 999,
        height: 120,
        offsetRight: 4,
        offsetBottom: 480,
      },
    },
  };

  const normalized = overlaySettings.normalizeSettingsV3(payload);

  assert.deepEqual(cloneValue(normalized), cloneValue(sharedSettings.normalizeSettingsV3(payload)));
  assert.equal(normalized.globalControls.overlayState.hidden, true);
  assert.equal(normalized.globalControls.overlayState.collapsed, false);
  assert.equal(normalized.globalControls.overlayState.width, 560);
  assert.equal(normalized.globalControls.overlayState.height, 360);
  assert.equal(normalized.globalControls.overlayState.offsetRight, 12);
  assert.equal(normalized.globalControls.overlayState.offsetBottom, 240);
});

test('react overlay settings contract: should expose SharedSettings builtin profiles', () => {
  const { overlaySettings, sharedSettings } = createOverlaySettingsModule();
  const normalized = overlaySettings.normalizeSettingsV3({});
  const sharedNormalized = sharedSettings.normalizeSettingsV3({});

  assert.deepEqual(
    cloneValue(
      ['gentle', 'balanced', 'intensive'].map((profileId) =>
        overlaySettings.getProfileConfigById(normalized, profileId)
      )
    ),
    cloneValue(
      ['gentle', 'balanced', 'intensive'].map((profileId) =>
        sharedSettings.getProfileConfigById(sharedNormalized, profileId)
      )
    )
  );
  assert.deepEqual(overlaySettings.CEFR_LEVELS, sharedSettings.CEFR_LEVELS);
  assert.deepEqual(overlaySettings.REVIEW_SPEEDS, sharedSettings.REVIEW_SPEEDS);
  assert.deepEqual(overlaySettings.REVIEW_DENSITIES, sharedSettings.REVIEW_DENSITIES);
});

test('react overlay settings contract: should delegate legacy migration to SharedSettings', () => {
  const { overlaySettings, sharedSettings } = createOverlaySettingsModule();
  const legacyPayload = {
    enabled: false,
    reviewDanmakuEnabled: true,
    webPageEnabled: false,
    domainRules: {
      'docs.example.com': { enabled: false },
    },
    activeLevels: ['IELTS'],
    replaceRatio: 0.3,
    maxReplaceCount: 4,
    targetCefr: 'C1',
    reviewDanmakuSpeed: 'fast',
    reviewDanmakuDensity: 'dense',
    vocabularyMode: 'full',
    examPreference: 'exam-first',
    overlayPanelHidden: true,
    overlayPanelCollapsed: true,
    overlayPanelWidth: 500,
    overlayPanelHeight: 700,
    overlayPanelOffsetRight: 80,
    overlayPanelOffsetBottom: 120,
  };

  assert.deepEqual(
    cloneValue(overlaySettings.migrateToV3(legacyPayload)),
    cloneValue(sharedSettings.migrateToV3(legacyPayload))
  );
});
