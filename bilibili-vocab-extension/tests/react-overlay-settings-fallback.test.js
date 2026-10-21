const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const OVERLAY_SETTINGS_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'lib',
  'overlay-settings.ts'
);
const BRIDGE_CORE_SOURCE_PATH = path.join(
  __dirname,
  '..',
  'react-ui',
  'src',
  'lib',
  'settings-bridge-core.ts'
);

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

// settings-bridge-core.ts performs no SharedSettings access at load time, so
// loading it into the sandbox keeps the load-failure semantics of the bridge.
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

function loadOverlaySettingsWithoutSharedSettings() {
  const overlayCode = transpileTsModule(OVERLAY_SETTINGS_SOURCE_PATH);
  const moduleRef = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
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
    Date,
    JSON,
    Math,
    Promise,
    Set,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.runInNewContext(overlayCode, sandbox, { filename: 'overlay-settings.js' });
  return moduleRef.exports;
}

test('react overlay settings bridge: should fail when SharedSettings is missing', () => {
  assert.throws(
    () => loadOverlaySettingsWithoutSharedSettings(),
    /SharedSettings is required before React overlay settings bridge loads/
  );
});
