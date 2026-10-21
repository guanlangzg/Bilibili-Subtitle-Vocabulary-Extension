const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  collectUnassignedTests,
  createExecutionPlan,
  createSpawnSpec,
  parseCliArgs,
  runContinuousOptimization,
  selectOptimizationCandidates,
} = require('../scripts/run-continuous-optimization.js');

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'continuous-optimization-'));
}

function createTestFiles(testsDir, names) {
  fs.mkdirSync(testsDir, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(path.join(testsDir, name), '', 'utf8');
  }
}

function readPackageScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
}

function readWorkflow(fileName) {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', fileName),
    'utf8'
  );
}

function collectDuplicateAssignments(shards) {
  const ownership = new Map();

  for (const shard of shards || []) {
    for (const testFile of shard.testFiles || []) {
      const assignedShards = ownership.get(testFile) || [];
      assignedShards.push(shard.name);
      ownership.set(testFile, assignedShards);
    }
  }

  return [...ownership.entries()]
    .filter(([, assignedShards]) => assignedShards.length > 1)
    .map(([testFile, assignedShards]) => ({
      testFile,
      assignedShards,
    }));
}

test('continuous optimization: parseCliArgs should support shard-only and report flags', () => {
  const parsed = parseCliArgs([
    '--shards-only',
    '--serial-shards',
    '--include-pack',
    '--report-only',
    '--json',
    '--report-dir',
    'custom-report',
  ]);

  assert.deepEqual(parsed, {
    includePack: true,
    parallelShards: false,
    runGates: false,
    reportDir: 'custom-report',
    json: true,
    reportOnly: true,
  });
});

test('continuous optimization: parseCliArgs should reject unknown or incomplete options', () => {
  assert.throws(() => parseCliArgs(['--unknown']), /Unknown continuous optimization option/);
  assert.throws(() => parseCliArgs(['--report-dir']), /Missing value for --report-dir/);
  assert.throws(() => parseCliArgs(['--report-dir', '--json']), /Missing value for --report-dir/);
  assert.throws(() => parseCliArgs(['--report-dir=']), /Missing value for --report-dir/);
});

test('continuous optimization: createSpawnSpec should use shell for windows cmd wrappers', () => {
  const spec = createSpawnSpec('pnpm.cmd', ['run', 'lint'], { platform: 'win32' });

  assert.deepEqual(spec, {
    command: 'pnpm.cmd run lint',
    args: [],
    shell: true,
  });
});

test('continuous optimization: createExecutionPlan should resolve gates and shard files', () => {
  const workspace = createWorkspace();
  const testsDir = path.join(workspace, 'tests');

  try {
    createTestFiles(testsDir, [
      'adaptive-tuning.test.js',
      'background.test.js',
      'experience-metrics.test.js',
      'learning-state.test.js',
      'shared-settings.test.js',
      'vocabulary.test.js',
      'contentScript-hit-tracking.test.js',
      'subtitleParser.test.js',
      'renderer.test.js',
      'translator.test.js',
      'tooltip.test.js',
      'contentScript-overlay-bridge.test.js',
      'react-ui-contract.test.js',
      'react-overlay-layout-contract.test.js',
      'react-overlay-settings-contract.test.js',
      'settings-layout.test.js',
      'test-ui-entry-contract.test.js',
      'build-entry-contract.test.js',
      'lint-entry-contract.test.js',
      'workflow-lockfile-contract.test.js',
      'continuous-optimization.test.js',
      'open-vocab-data.test.js',
      'scheduler.test.js',
      'danmaku.test.js',
      'shared-settings-integration.test.js',
      'check-overlay-size.test.js',
      'refresh-overlay-size-baseline.test.js',
      'pack-extension.test.js',
      'test-coverage-entry-contract.test.js',
    ]);

    const plan = createExecutionPlan({
      projectRoot: workspace,
      testsDir,
      includePack: true,
      platform: 'win32',
    });

    assert.deepEqual(
      plan.gates.map((gate) => gate.name),
      ['lint', 'typecheck', 'build-extension', 'pack']
    );
    assert.equal(plan.gates[0].command, 'pnpm.cmd');
    assert.deepEqual(
      plan.shards.map((shard) => shard.name),
      ['runtime-state', 'subtitle-content', 'ui-overlay', 'build-contract-data']
    );
    assert.equal(plan.shards[0].testFileCount, 7);
    assert.ok(
      plan.shards[0].testFiles.includes(path.join('tests', 'shared-settings-integration.test.js'))
    );
    assert.equal(plan.shards[1].testFileCount, 5);
    assert.deepEqual(plan.shards[2].testFiles, [
      path.join('tests', 'contentScript-overlay-bridge.test.js'),
      path.join('tests', 'react-overlay-layout-contract.test.js'),
      path.join('tests', 'react-overlay-settings-contract.test.js'),
      path.join('tests', 'react-ui-contract.test.js'),
      path.join('tests', 'settings-layout.test.js'),
    ]);
    assert.ok(
      plan.shards[3].testFiles.includes(path.join('tests', 'continuous-optimization.test.js'))
    );
    assert.ok(
      plan.shards[3].testFiles.includes(path.join('tests', 'test-ui-entry-contract.test.js'))
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('continuous optimization: current shard plan should not duplicate test files across shards', () => {
  const plan = createExecutionPlan({
    projectRoot: path.join(__dirname, '..'),
    testsDir: path.join(__dirname),
  });

  assert.deepEqual(collectDuplicateAssignments(plan.shards), []);
});

test('continuous optimization: current shard plan should only leave explicit smoke specs out of band', () => {
  const testsDir = path.join(__dirname);
  const plan = createExecutionPlan({
    projectRoot: path.join(__dirname, '..'),
    testsDir,
  });

  assert.deepEqual(collectUnassignedTests(testsDir, plan.shards), [
    'browser-extension-smoke.spec.js',
    'extension-zip-smoke.spec.js',
    'real-site-smoke.spec.js',
  ]);
});

test('continuous optimization: current shard plan should route runtime bridge and lightweight adapter direct tests', () => {
  const plan = createExecutionPlan({
    projectRoot: path.join(__dirname, '..'),
    testsDir: path.join(__dirname),
  });
  const runtimeState = plan.shards.find((shard) => shard.name === 'runtime-state');
  const subtitleContent = plan.shards.find((shard) => shard.name === 'subtitle-content');
  const uiOverlay = plan.shards.find((shard) => shard.name === 'ui-overlay');
  const buildContractData = plan.shards.find((shard) => shard.name === 'build-contract-data');

  assert.ok(runtimeState);
  assert.ok(subtitleContent);
  assert.ok(uiOverlay);
  assert.ok(buildContractData);

  assert.deepEqual(
    runtimeState.testFiles.filter((file) =>
      ['config.test.js', 'runtime-messaging.test.js', 'utils.test.js'].includes(path.basename(file))
    ),
    [
      path.join('tests', 'config.test.js'),
      path.join('tests', 'runtime-messaging.test.js'),
      path.join('tests', 'utils.test.js'),
    ]
  );
  assert.deepEqual(
    subtitleContent.testFiles.filter((file) =>
      [
        'contentScript-init.test.js',
        'contentScript-observer-throttle.test.js',
        'contentScript-subtitle-navigation.test.js',
        'contentScript-timeline-polling.test.js',
        'contentScript-translation-pipeline.test.js',
        'contentScript-web-text-safety.test.js',
      ].includes(path.basename(file))
    ),
    [
      path.join('tests', 'contentScript-init.test.js'),
      path.join('tests', 'contentScript-observer-throttle.test.js'),
      path.join('tests', 'contentScript-subtitle-navigation.test.js'),
      path.join('tests', 'contentScript-timeline-polling.test.js'),
      path.join('tests', 'contentScript-translation-pipeline.test.js'),
      path.join('tests', 'contentScript-web-text-safety.test.js'),
    ]
  );
  assert.deepEqual(
    uiOverlay.testFiles.filter((file) =>
      ['contentScript-overlay-bridge.test.js'].includes(path.basename(file))
    ),
    [path.join('tests', 'contentScript-overlay-bridge.test.js')]
  );
  assert.deepEqual(
    buildContractData.testFiles.filter((file) =>
      [
        'check-extension-package.test.js',
        'extension-smoke-helpers.test.js',
        'remote-test-entry-contract.test.js',
      ].includes(path.basename(file))
    ),
    [
      path.join('tests', 'check-extension-package.test.js'),
      path.join('tests', 'extension-smoke-helpers.test.js'),
      path.join('tests', 'remote-test-entry-contract.test.js'),
    ]
  );
});

test('continuous optimization: selectOptimizationCandidates should prioritize failures', () => {
  const candidates = selectOptimizationCandidates({
    gates: [
      {
        name: 'lint',
        title: 'Lint',
        status: 'fail',
        commandLine: 'pnpm run lint',
      },
    ],
    shards: [
      {
        name: 'ui-overlay',
        title: 'Popup / options / React UI / overlay',
        status: 'fail',
        commandLine: 'node --test tests/react-ui-contract.test.js',
        testFiles: [path.join('tests', 'react-ui-contract.test.js')],
      },
    ],
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ['gate-lint', 'shard-ui-overlay']
  );
});

test('continuous optimization: runContinuousOptimization should write reports and carry failures', async () => {
  const workspace = createWorkspace();
  const testsDir = path.join(workspace, 'tests');
  const reportDir = path.join(workspace, 'reports');

  try {
    createTestFiles(testsDir, [
      'adaptive-tuning.test.js',
      'background.test.js',
      'experience-metrics.test.js',
      'learning-state.test.js',
      'shared-settings.test.js',
      'vocabulary.test.js',
      'contentScript-hit-tracking.test.js',
      'subtitleParser.test.js',
      'renderer.test.js',
      'translator.test.js',
      'tooltip.test.js',
      'react-ui-contract.test.js',
      'react-overlay-layout-contract.test.js',
      'react-overlay-settings-contract.test.js',
      'settings-layout.test.js',
      'test-ui-entry-contract.test.js',
      'build-entry-contract.test.js',
      'lint-entry-contract.test.js',
      'workflow-lockfile-contract.test.js',
      'continuous-optimization.test.js',
      'open-vocab-data.test.js',
      'scheduler.test.js',
      'danmaku.test.js',
      'check-overlay-size.test.js',
      'refresh-overlay-size-baseline.test.js',
      'pack-extension.test.js',
      'test-coverage-entry-contract.test.js',
    ]);

    const summary = await runContinuousOptimization({
      projectRoot: workspace,
      testsDir,
      reportDir,
      runId: 'RUN-001',
      executeCommand(command, args) {
        const joinedArgs = Array.isArray(args) ? args.join(' ') : '';
        const isUiShard = joinedArgs.includes('react-ui-contract.test.js');
        const isLintGate = joinedArgs === 'run lint';

        return Promise.resolve({
          status: isLintGate || isUiShard ? 1 : 0,
          durationMs: 25,
          stdout: `${command} ${joinedArgs}`.trim(),
          stderr: isUiShard ? 'ui shard failed' : '',
        });
      },
    });

    assert.equal(summary.overallStatus, 'fail');
    assert.equal(summary.gates.length, 3);
    assert.equal(summary.shards.length, 4);
    assert.deepEqual(
      summary.nextFocusCandidates.map((candidate) => candidate.id),
      ['gate-lint', 'shard-ui-overlay']
    );
    assert.equal(fs.existsSync(path.join(reportDir, 'latest.json')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'latest.md')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'RUN-001.json')), true);

    const latestReport = JSON.parse(fs.readFileSync(path.join(reportDir, 'latest.json'), 'utf8'));
    assert.equal(latestReport.runId, 'RUN-001');
    assert.equal(latestReport.overallStatus, 'fail');

    const markdown = fs.readFileSync(path.join(reportDir, 'latest.md'), 'utf8');
    assert.match(markdown, /Continuous Optimization Report/);
    assert.match(markdown, /修复 gate 失败：Lint/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('continuous optimization: runContinuousOptimization should keep legacy popup/options deferred and browser smoke out of shard coverage', async () => {
  const workspace = createWorkspace();
  const testsDir = path.join(workspace, 'tests');
  const reportDir = path.join(workspace, 'reports');

  try {
    createTestFiles(testsDir, [
      'adaptive-tuning.test.js',
      'background.test.js',
      'experience-metrics.test.js',
      'learning-state.test.js',
      'shared-settings.test.js',
      'vocabulary.test.js',
      'contentScript-hit-tracking.test.js',
      'subtitleParser.test.js',
      'renderer.test.js',
      'translator.test.js',
      'tooltip.test.js',
      'react-ui-contract.test.js',
      'react-overlay-layout-contract.test.js',
      'react-overlay-settings-contract.test.js',
      'settings-layout.test.js',
      'test-ui-entry-contract.test.js',
      'build-entry-contract.test.js',
      'lint-entry-contract.test.js',
      'workflow-lockfile-contract.test.js',
      'continuous-optimization.test.js',
      'open-vocab-data.test.js',
      'scheduler.test.js',
      'danmaku.test.js',
      'check-overlay-size.test.js',
      'refresh-overlay-size-baseline.test.js',
      'pack-extension.test.js',
      'test-coverage-entry-contract.test.js',
      'browser-extension-smoke.spec.js',
      'extension-zip-smoke.spec.js',
      'real-site-smoke.spec.js',
      'popup.test.js',
    ]);

    const summary = await runContinuousOptimization({
      projectRoot: workspace,
      testsDir,
      reportDir,
      runId: 'RUN-UNASSIGNED',
      executeCommand() {
        return Promise.resolve({
          status: 0,
          durationMs: 25,
          stdout: '',
          stderr: '',
        });
      },
    });

    assert.equal(summary.overallStatus, 'pass');
    assert.deepEqual(summary.unassignedTests, []);
    assert.deepEqual(summary.outOfBandSmokeTests, [
      'browser-extension-smoke.spec.js',
      'extension-zip-smoke.spec.js',
      'real-site-smoke.spec.js',
    ]);
    assert.deepEqual(summary.deferredLegacyTests, ['popup.test.js']);
    assert.equal(summary.nextFocusCandidates[0].id, 'content-script-decomposition');

    const deferredCandidate = summary.nextFocusCandidates.at(-1);
    assert.equal(deferredCandidate.id, 'legacy-deferred-tests');
    assert.equal(deferredCandidate.title, '迁移或淘汰 legacy popup/options shell 测试');
    assert.deepEqual(deferredCandidate.files, ['popup.test.js']);
    assert.match(
      deferredCandidate.rationale,
      /dist\/popup\.html.*dist\/options\.html[\s\S]*legacy popup\/options 入口/
    );
    assert.match(deferredCandidate.rationale, /shared-settings-integration\.test\.js/);

    const latestReport = JSON.parse(fs.readFileSync(path.join(reportDir, 'latest.json'), 'utf8'));
    assert.deepEqual(latestReport.unassignedTests, []);
    assert.deepEqual(latestReport.outOfBandSmokeTests, [
      'browser-extension-smoke.spec.js',
      'extension-zip-smoke.spec.js',
      'real-site-smoke.spec.js',
    ]);
    assert.deepEqual(latestReport.deferredLegacyTests, ['popup.test.js']);
    assert.equal(latestReport.nextFocusCandidates[0].id, 'content-script-decomposition');

    const markdown = fs.readFileSync(path.join(reportDir, 'latest.md'), 'utf8');
    assert.match(markdown, /Out-of-Band Smoke Tests/);
    assert.match(markdown, /browser-extension-smoke\.spec\.js/);
    assert.match(markdown, /extension-zip-smoke\.spec\.js/);
    assert.match(markdown, /real-site-smoke\.spec\.js/);
    assert.match(markdown, /pnpm run test:extension-smoke/);
    assert.match(markdown, /pnpm run test:zip-smoke/);
    assert.match(markdown, /pnpm run test:real-site-smoke/);
    assert.match(markdown, /Legacy Deferred Tests/);
    assert.match(markdown, /popup\.test\.js/);
    assert.match(
      markdown,
      /manifest \/ pack 真实交付入口是 `dist\/popup\.html` \/ `dist\/options\.html`[\s\S]*root `popup\.js` \/ `options\.js`/
    );
    assert.match(markdown, /迁移可复用逻辑到 shared helper 或单独 legacy lane/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('continuous optimization: report-only mode should write coverage report without executing commands', async () => {
  const workspace = createWorkspace();
  const testsDir = path.join(workspace, 'tests');
  const reportDir = path.join(workspace, 'reports');

  try {
    createTestFiles(testsDir, [
      'adaptive-tuning.test.js',
      'background.test.js',
      'experience-metrics.test.js',
      'learning-state.test.js',
      'shared-settings.test.js',
      'vocabulary.test.js',
      'contentScript-hit-tracking.test.js',
      'subtitleParser.test.js',
      'renderer.test.js',
      'translator.test.js',
      'tooltip.test.js',
      'react-ui-contract.test.js',
      'react-overlay-layout-contract.test.js',
      'react-overlay-settings-contract.test.js',
      'settings-layout.test.js',
      'test-ui-entry-contract.test.js',
      'build-entry-contract.test.js',
      'lint-entry-contract.test.js',
      'workflow-lockfile-contract.test.js',
      'continuous-optimization.test.js',
      'open-vocab-data.test.js',
      'scheduler.test.js',
      'danmaku.test.js',
      'check-overlay-size.test.js',
      'refresh-overlay-size-baseline.test.js',
      'pack-extension.test.js',
      'test-coverage-entry-contract.test.js',
    ]);

    const executedCommands = [];
    const summary = await runContinuousOptimization({
      projectRoot: workspace,
      testsDir,
      reportDir,
      reportOnly: true,
      runId: 'RUN-REPORT-ONLY',
      executeCommand(command, args) {
        executedCommands.push([command, ...(args || [])]);
        return Promise.resolve({ status: 1, durationMs: 25, stdout: '', stderr: '' });
      },
    });

    assert.deepEqual(executedCommands, []);
    assert.equal(summary.overallStatus, 'pass');
    assert.equal(summary.reportOnly, true);
    assert.deepEqual(
      summary.gates.map((gate) => gate.status),
      ['skipped', 'skipped', 'skipped']
    );
    assert.deepEqual(
      summary.shards.map((shard) => shard.status),
      ['skipped', 'skipped', 'skipped', 'skipped']
    );
    assert.deepEqual(summary.unassignedTests, []);
    assert.equal(fs.existsSync(path.join(reportDir, 'latest.md')), true);

    const markdown = fs.readFileSync(path.join(reportDir, 'latest.md'), 'utf8');
    assert.match(markdown, /Report Only: `true`/);
    assert.match(markdown, /\| Runtime \/ state \| SKIPPED \|/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('continuous optimization contract: package should expose only local shard and cycle scripts', () => {
  const scripts = readPackageScripts();

  assert.equal(scripts['test:shards'], 'node scripts/run-continuous-optimization.js --shards-only');
  assert.equal(scripts['optimize:continuous'], 'node scripts/run-continuous-optimization.js');
  assert.equal(scripts['optimize:continuous:ci'], undefined);
});

test('continuous optimization contract: ci workflow should generate report directly', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(workflow, /^  continuous-optimization-inventory:\r?$/m);
  assert.match(
    workflow,
    /continuous-optimization-inventory:[\s\S]*run: node scripts\/run-continuous-optimization\.js --report-only/
  );
  assert.doesNotMatch(
    workflow,
    /continuous-optimization-inventory:[\s\S]*pnpm run optimize:continuous:ci/
  );
  assert.doesNotMatch(workflow, /continuous-optimization-inventory:[\s\S]*--serial-shards/);
});

test('continuous optimization contract: ci workflow should upload continuous optimization reports', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(
    workflow,
    /continuous-optimization-inventory:[\s\S]*uses: actions\/upload-artifact@v4[\s\S]*name: continuous-optimization-inventory-report/
  );
  assert.match(
    workflow,
    /continuous-optimization-inventory:[\s\S]*path: \$\{\{\s*env\.WORKDIR\s*\}\}\/test-results\/continuous-optimization/
  );
});

test('continuous optimization contract: ci workflow should run windows smoke without rebuilding', () => {
  const workflow = readWorkflow('ci.yml');

  assert.doesNotMatch(workflow, /^  extension-smoke-windows:\r?$/m);
  assert.match(workflow, /^  pack-windows-smoke:\r?$/m);
  assert.match(workflow, /pack-windows-smoke:[\s\S]*runs-on: windows-latest/);
  assert.match(workflow, /pack-windows-smoke:[\s\S]*run: pnpm run build:extension/);
  assert.match(workflow, /pack-windows-smoke:[\s\S]*run: pnpm run test:extension-smoke:built/);
  assert.doesNotMatch(workflow, /run: pnpm run test:extension-smoke\r?$/m);
});
