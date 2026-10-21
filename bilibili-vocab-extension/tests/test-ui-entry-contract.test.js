const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { collectUiTestFiles, parseCliArgs, runUiTests } = require('../scripts/run-ui-tests.js');

function readPackageScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
}

function normalizeScript(script) {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('test ui entry contract: test:ui should not run vitest with root-wide scan', () => {
  const scripts = readPackageScripts();
  const testUiScript = normalizeScript(scripts['test:ui']);

  assert.notEqual(testUiScript, '');
  assert.doesNotMatch(testUiScript, /(?:^|\s)vitest\s+run\s+--root\s+\.(?:\s|$)/);
});

test('test ui entry contract: test:ui should explicitly target ui-related scope', () => {
  const scripts = readPackageScripts();
  const testUiScript = normalizeScript(scripts['test:ui']);

  assert.match(testUiScript, /^node scripts\/run-ui-tests\.js$/);
});

test('test ui entry contract: workspace should not keep legacy-only settings redesign contract', () => {
  const legacyContractPath = path.join(__dirname, 'settings-redesign.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only anki export contract', () => {
  const legacyContractPath = path.join(__dirname, 'options-anki-export.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only clear-vocabulary contract', () => {
  const legacyContractPath = path.join(__dirname, 'options-clear-vocab-error-guard.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only import-settings contract', () => {
  const legacyContractPath = path.join(__dirname, 'options-import-reset-behavior.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only import/reset source contract', () => {
  const legacyContractPath = path.join(__dirname, 'options-import-reset-contract.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only popup metric contract', () => {
  const legacyContractPath = path.join(__dirname, 'popup-expressive-ui.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only popup active-level fallback contract', () => {
  const legacyContractPath = path.join(__dirname, 'popup-live-preview-sync.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only popup quick-review robustness contract', () => {
  const legacyContractPath = path.join(__dirname, 'popup-quick-review-robustness.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only popup helper contract bundle', () => {
  const legacyContractPath = path.join(__dirname, 'popup.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only popup storage error guard contract', () => {
  const legacyContractPath = path.join(__dirname, 'popup-storage-error-guard.test.js');

  assert.equal(fs.existsSync(legacyContractPath), false);
});

test('test ui entry contract: workspace should not keep legacy-only overlay panel contract bundle', () => {
  const remainingLegacyContracts = [
    'overlay-panel.test.js',
    'overlay-panel-experience.test.js',
    'overlay-panel-learning.test.js',
    'overlay-panel-mount-idempotent.test.js',
    'overlay-panel-position.test.js',
    'overlay-panel-presets.test.js',
    'overlay-panel-scroll.test.js',
  ].filter((fileName) => fs.existsSync(path.join(__dirname, fileName)));

  assert.deepEqual(remainingLegacyContracts, []);
});

test('test ui entry contract: run-ui-tests should select only ui contract files', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ui-tests-'));
  const testsDir = path.join(workspace, 'tests');

  try {
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'popup.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'popup-live-preview-sync.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'contentScript-overlay-bridge.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'overlay-panel.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'react-overlay-layout-contract.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'react-overlay-settings-contract.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'react-ui-contract.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'renderer.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'settings-layout.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'settings-redesign.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'shared-settings-integration.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'test-ui-entry-contract.test.js'), '', 'utf8');

    const testFiles = collectUiTestFiles(testsDir);

    assert.deepEqual(testFiles, [
      path.join('tests', 'contentScript-overlay-bridge.test.js'),
      path.join('tests', 'react-overlay-layout-contract.test.js'),
      path.join('tests', 'react-overlay-settings-contract.test.js'),
      path.join('tests', 'react-ui-contract.test.js'),
      path.join('tests', 'settings-layout.test.js'),
    ]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('test ui entry contract: current workspace should include runtime bridge and lightweight adapter direct ui tests', () => {
  const testFiles = collectUiTestFiles(path.join(__dirname));

  assert.deepEqual(
    testFiles.filter((file) =>
      ['contentScript-overlay-bridge.test.js'].includes(path.basename(file))
    ),
    [path.join('tests', 'contentScript-overlay-bridge.test.js')]
  );
});

test('test ui entry contract: current workspace should include every named ui test family', () => {
  const expectedUiTestFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name.startsWith('background-overlay') ||
        name.startsWith('react-overlay-') ||
        name.startsWith('react-settings-') ||
        name.startsWith('react-ui-') ||
        [
          'contentScript-overlay-bridge.test.js',
          'contentScript-overlay-loader.test.js',
          'settings-layout.test.js',
        ].includes(name)
    )
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join('tests', name));

  assert.deepEqual(collectUiTestFiles(path.join(__dirname)), expectedUiTestFiles);
});

test('test ui entry contract: current workspace should keep shipped react overlay contracts instead of legacy overlay shell tests', () => {
  const testFiles = collectUiTestFiles(path.join(__dirname));

  assert.equal(
    testFiles.some((file) => path.basename(file).startsWith('overlay-panel')),
    false
  );
  assert.deepEqual(
    testFiles.filter((file) =>
      ['react-overlay-layout-contract.test.js', 'react-overlay-settings-contract.test.js'].includes(
        path.basename(file)
      )
    ),
    [
      path.join('tests', 'react-overlay-layout-contract.test.js'),
      path.join('tests', 'react-overlay-settings-contract.test.js'),
    ]
  );
});

test('test ui entry contract: cli args should reject unknown options', () => {
  assert.deepEqual(parseCliArgs([]), {});
  assert.throws(() => parseCliArgs(['--pattern', 'react-ui']), /Unknown UI test option: --pattern/);
});

test('test ui entry contract: run-ui-tests should execute node test with explicit file list', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ui-tests-runner-'));
  const testsDir = path.join(workspace, 'tests');

  try {
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'popup.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'contentScript-overlay-bridge.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'overlay-panel.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'react-overlay-layout-contract.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'react-ui-contract.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'settings-layout.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'test-ui-entry-contract.test.js'), '', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'renderer.test.js'), '', 'utf8');

    const calls = [];
    const result = runUiTests({
      projectRoot: workspace,
      testsDir,
      runner(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0 };
      },
      execPath: 'node',
      stdio: 'pipe',
    });

    assert.equal(result.status, 0);
    assert.deepEqual(calls, [
      {
        command: 'node',
        args: [
          '--test',
          path.join('tests', 'contentScript-overlay-bridge.test.js'),
          path.join('tests', 'react-overlay-layout-contract.test.js'),
          path.join('tests', 'react-ui-contract.test.js'),
          path.join('tests', 'settings-layout.test.js'),
        ],
        options: {
          cwd: workspace,
          stdio: 'pipe',
        },
      },
    ]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
