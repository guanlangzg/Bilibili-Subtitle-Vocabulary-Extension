const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  EXCLUDED_PUBLISH_ENTRIES,
  REQUIRED_ARCHIVE_ENTRIES,
  collectHtmlAssetReferences,
  collectPackEntries,
  buildWindowsArchiveScript,
  parseZipEntryList,
  parsePowerShellZipEntries,
  collectArchiveRoots,
  shouldExcludePublishEntry,
  validateArchiveEntries,
  shouldRetryWindowsPack,
  runPackCommandWithRetry,
  createZipCommand,
  createPackStageRoot,
  parseCliArgs,
  runPack,
} = require('../scripts/pack-extension.js');

function createWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-extension-'));
  fs.mkdirSync(path.join(workspace, 'dist', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'manifest.json'),
    JSON.stringify(
      {
        background: { service_worker: 'background.js' },
        content_scripts: [
          {
            js: ['contentScript/index.js', 'scripts/danmaku.js', 'scripts/scheduler.js'],
            css: ['styles.css'],
          },
        ],
        options_page: 'dist/options.html',
        action: { default_popup: 'dist/popup.html' },
        web_accessible_resources: [
          {
            resources: ['dist/overlay.js'],
            matches: ['https://*/*'],
          },
        ],
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(path.join(workspace, 'styles.css'), 'body{}', 'utf8');
  fs.writeFileSync(
    path.join(workspace, 'background.js'),
    `importScripts(
  'sharedSettings.js',
  'runtimeMessaging.js',
  'learningState.js',
  'background-settings.js',
  'background-storage.js',
  'background-learning-state.js',
  'background-message-handler.js',
  'background-commands.js'
);
`,
    'utf8'
  );
  fs.writeFileSync(path.join(workspace, 'sharedSettings.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'runtimeMessaging.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'learningState.js'), '', 'utf8');
  fs.writeFileSync(
    path.join(workspace, 'background-settings.js'),
    `importScripts('sharedSettings.js');`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workspace, 'background-storage.js'),
    `importScripts('background-settings.js');`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workspace, 'background-learning-state.js'),
    `importScripts('learningState.js', 'background-storage.js');`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workspace, 'background-message-handler.js'),
    `importScripts('runtimeMessaging.js', 'background-storage.js', 'background-learning-state.js');`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workspace, 'background-commands.js'),
    `importScripts('background-message-handler.js');`,
    'utf8'
  );
  fs.mkdirSync(path.join(workspace, 'contentScript'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'contentScript', 'index.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'scripts', 'danmaku.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'scripts', 'scheduler.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'scripts', 'build-vocab-dataset.js'), '', 'utf8');
  fs.writeFileSync(
    path.join(workspace, 'dist', 'options.html'),
    `<html>
  <head>
    <script type="module" src="./assets/options.js"></script>
    <link rel="modulepreload" href="./assets/study-preview-chunk.js">
    <link rel="stylesheet" href="./assets/study-preview.css">
  </head>
</html>`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workspace, 'dist', 'popup.html'),
    `<html>
  <head>
    <script type="module" src="./assets/popup.js"></script>
    <link rel="modulepreload" href="./assets/study-preview-chunk.js">
    <link rel="stylesheet" href="./assets/study-preview.css">
  </head>
</html>`,
    'utf8'
  );
  fs.writeFileSync(path.join(workspace, 'dist', 'overlay.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'dist', 'assets', 'options.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'dist', 'assets', 'popup.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'dist', 'assets', 'study-preview-chunk.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'dist', 'assets', 'study-preview.css'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'dist', 'assets', 'debug.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'dist', 'overlay-size-report.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(workspace, 'data', 'cet4.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(workspace, 'README.md'), 'ignore', 'utf8');
  return workspace;
}

test('pack extension: collectPackEntries should follow manifest and html runtime assets', () => {
  const workspace = createWorkspace();
  try {
    const entries = collectPackEntries(workspace);

    assert.deepEqual(entries, [
      'manifest.json',
      'background.js',
      'contentScript/index.js',
      'scripts/danmaku.js',
      'scripts/scheduler.js',
      'styles.css',
      'dist/options.html',
      'dist/assets/options.js',
      'dist/assets/study-preview-chunk.js',
      'dist/assets/study-preview.css',
      'dist/popup.html',
      'dist/assets/popup.js',
      'dist/overlay.js',
      'data',
      'sharedSettings.js',
      'runtimeMessaging.js',
      'learningState.js',
      'background-settings.js',
      'background-storage.js',
      'background-learning-state.js',
      'background-message-handler.js',
      'background-commands.js',
    ]);
    assert.equal(entries.includes('dist'), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: collectHtmlAssetReferences should ignore non-package html references', () => {
  const workspace = createWorkspace();
  try {
    fs.writeFileSync(
      path.join(workspace, 'dist', 'external.html'),
      `<script src="./assets/options.js?v=1"></script>
<link href="https://cdn.example.com/reset.css" rel="stylesheet">
<a href="#local"></a>
<img src="/dist/assets/popup.js#hash">`,
      'utf8'
    );

    assert.deepEqual(collectHtmlAssetReferences(workspace, 'dist/external.html'), [
      'dist/assets/options.js',
      'dist/assets/popup.js',
    ]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: createPackStageRoot should stage only manifest-listed scripts', () => {
  const workspace = createWorkspace();
  try {
    const entries = collectPackEntries(workspace);
    const stagingRoot = createPackStageRoot(workspace, entries, { stagePublishData: false });

    try {
      assert.equal(fs.existsSync(path.join(stagingRoot, 'scripts', 'danmaku.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'scripts', 'scheduler.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'runtimeMessaging.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'learningState.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'background-settings.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'background-storage.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'background-learning-state.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'background-message-handler.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'background-commands.js')), true);
      assert.equal(
        fs.existsSync(path.join(stagingRoot, 'scripts', 'build-vocab-dataset.js')),
        false
      );
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: createPackStageRoot should stage only manifest and html dist assets', () => {
  const workspace = createWorkspace();
  try {
    const entries = collectPackEntries(workspace);
    const stagingRoot = createPackStageRoot(workspace, entries, { stagePublishData: false });

    try {
      assert.equal(fs.existsSync(path.join(stagingRoot, 'dist', 'options.html')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'dist', 'popup.html')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'dist', 'overlay.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'dist', 'assets', 'options.js')), true);
      assert.equal(fs.existsSync(path.join(stagingRoot, 'dist', 'assets', 'popup.js')), true);
      assert.equal(
        fs.existsSync(path.join(stagingRoot, 'dist', 'assets', 'study-preview-chunk.js')),
        true
      );
      assert.equal(
        fs.existsSync(path.join(stagingRoot, 'dist', 'assets', 'study-preview.css')),
        true
      );
      assert.equal(fs.existsSync(path.join(stagingRoot, 'dist', 'assets', 'debug.js')), false);
      assert.equal(
        fs.existsSync(path.join(stagingRoot, 'dist', 'overlay-size-report.json')),
        false
      );
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: shouldExcludePublishEntry should document build-only diagnostics', () => {
  const workspace = createWorkspace();
  try {
    assert.deepEqual(EXCLUDED_PUBLISH_ENTRIES, ['dist/overlay-size-report.json']);
    assert.equal(
      shouldExcludePublishEntry(
        workspace,
        path.join(workspace, 'dist', 'overlay-size-report.json')
      ),
      true
    );
    assert.equal(
      shouldExcludePublishEntry(workspace, path.join(workspace, 'dist', 'options.html')),
      false
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: collectArchiveRoots should keep directory roots for exact nested entries', () => {
  assert.deepEqual(
    collectArchiveRoots([
      'manifest.json',
      'background.js',
      'sharedSettings.js',
      'runtimeMessaging.js',
      'learningState.js',
      'background-settings.js',
      'background-storage.js',
      'background-learning-state.js',
      'background-message-handler.js',
      'background-commands.js',
      'scripts/danmaku.js',
      'scripts/scheduler.js',
      'dist/options.html',
      'dist/assets/options.js',
      'dist/overlay.js',
      'data/cet4.json',
    ]),
    [
      'manifest.json',
      'background.js',
      'sharedSettings.js',
      'runtimeMessaging.js',
      'learningState.js',
      'background-settings.js',
      'background-storage.js',
      'background-learning-state.js',
      'background-message-handler.js',
      'background-commands.js',
      'scripts',
      'dist',
      'data',
    ]
  );
});

test('pack extension: cli args should reject unknown options', () => {
  assert.deepEqual(parseCliArgs([]), {});
  assert.throws(() => parseCliArgs(['--output', 'custom.zip']), /Unknown pack option: --output/);
});

test('pack extension: collectPackEntries should fail when a required fixed path is missing', () => {
  const workspace = createWorkspace();
  try {
    fs.rmSync(path.join(workspace, 'contentScript', 'index.js'), { force: true });

    assert.throws(
      () => collectPackEntries(workspace),
      /Pack entry missing required path: contentScript[\\/]index\.js/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: createZipCommand should use zip on non-windows platform', () => {
  const workspace = createWorkspace();
  try {
    const outputZip = path.join(workspace, 'extension.zip');
    const entries = ['dist', 'manifest.json'];
    const command = createZipCommand(workspace, outputZip, entries, { platform: 'linux' });

    assert.equal(command.command, 'zip');
    assert.deepEqual(command.args, ['-r', outputZip, ...entries]);
    assert.equal(typeof command.cleanup, 'object');
    assert.equal(command.cleanup, null);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: createZipCommand should use powershell script on windows', () => {
  const workspace = createWorkspace();
  try {
    const outputZip = path.join(workspace, 'extension.zip');
    const entries = ['dist', 'manifest.json'];
    const command = createZipCommand(workspace, outputZip, entries, { platform: 'win32' });

    assert.equal(command.command, 'powershell');
    assert.equal(command.args[0], '-NoProfile');
    assert.equal(command.args[3], '-File');

    const scriptPath = command.args[4];
    const script = fs.readFileSync(scriptPath, 'utf8');
    assert.match(script, /Compress-Archive/);
    assert.match(script, /manifest\.json/);

    assert.equal(typeof command.cleanup, 'function');
    command.cleanup();
    assert.equal(fs.existsSync(path.dirname(scriptPath)), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: buildWindowsArchiveScript should escape single quotes', () => {
  const script = buildWindowsArchiveScript("C:/tmp/o'hare.zip", ['dist', "mani'fest.json"]);

  assert.match(script, /o''hare\.zip/);
  assert.match(script, /mani''fest\.json/);
});

test('pack extension: runPack should execute command and require archive output', () => {
  const workspace = createWorkspace();
  try {
    const outputZip = path.join(workspace, 'extension.zip');
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'zip') {
        fs.writeFileSync(outputZip, 'zip', 'utf8');
        return { status: 0 };
      }
      if (command === 'unzip') {
        return {
          status: 0,
          stdout: `
Archive:  ${outputZip}
  Length      Date    Time    Name
---------  ---------- -----   ----
        34  2026-04-16 00:00   manifest.json
        0  2026-04-16 00:00   background.js
        0  2026-04-16 00:00   sharedSettings.js
        0  2026-04-16 00:00   runtimeMessaging.js
        0  2026-04-16 00:00   learningState.js
        0  2026-04-16 00:00   background-settings.js
        0  2026-04-16 00:00   background-storage.js
        0  2026-04-16 00:00   background-learning-state.js
        0  2026-04-16 00:00   background-message-handler.js
        0  2026-04-16 00:00   background-commands.js
        0  2026-04-16 00:00   contentScript/index.js
        0  2026-04-16 00:00   scripts/danmaku.js
        0  2026-04-16 00:00   scripts/scheduler.js
        7  2026-04-16 00:00   styles.css
      123  2026-04-16 00:00   dist/options.html
      456  2026-04-16 00:00   dist/assets/options.js
      456  2026-04-16 00:00   dist/assets/study-preview-chunk.js
      123  2026-04-16 00:00   dist/assets/study-preview.css
      123  2026-04-16 00:00   dist/popup.html
      456  2026-04-16 00:00   dist/assets/popup.js
      456  2026-04-16 00:00   dist/overlay.js
        0  2026-04-16 00:00   data/
---------                     -------
`,
        };
      }
      throw new Error(`Unexpected command ${command}`);
    };

    const result = runPack({
      rootDir: workspace,
      platform: 'linux',
      runner,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, 'zip');
    assert.deepEqual(calls[0].args, [
      '-r',
      outputZip,
      'manifest.json',
      'background.js',
      'contentScript',
      'scripts',
      'styles.css',
      'dist',
      'data',
      'sharedSettings.js',
      'runtimeMessaging.js',
      'learningState.js',
      'background-settings.js',
      'background-storage.js',
      'background-learning-state.js',
      'background-message-handler.js',
      'background-commands.js',
    ]);
    assert.equal(calls[1].command, 'unzip');
    assert.match(result.outputZipPath, /extension\.zip$/);
    assert.equal(fs.existsSync(result.outputZipPath), true);
    assert.ok(result.entries.includes('manifest.json'));
    assert.equal(result.entries.includes('popup.html'), false);
    assert.ok(result.archiveEntries.includes('manifest.json'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: runPack should fail when command exits non-zero', () => {
  const workspace = createWorkspace();
  try {
    assert.throws(
      () =>
        runPack({
          rootDir: workspace,
          platform: 'linux',
          runner: (command) => {
            if (command === 'zip') {
              return { status: 1 };
            }
            return { status: 0, stdout: '' };
          },
        }),
      /exit code 1/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: runPack should fail when no files matched', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-extension-empty-'));
  try {
    assert.throws(
      () =>
        runPack({
          rootDir: workspace,
          platform: 'linux',
          fixedPaths: [],
          globPatterns: [],
        }),
      /No files matched/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: runPack should stage publish-safe data when a dataset builder is available', () => {
  const workspace = createWorkspace();
  try {
    fs.mkdirSync(path.join(workspace, 'sources'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, 'scripts', 'build-vocab-dataset.js'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const outputDir = process.argv[process.argv.indexOf('--output-dir') + 1];
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'cet4.json'), JSON.stringify([{ word: 'publish-only' }]), 'utf8');
fs.writeFileSync(path.join(outputDir, 'sources.json'), JSON.stringify({ target: 'publish' }), 'utf8');
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(workspace, 'data', 'cet4.json'),
      JSON.stringify([{ word: 'raw-data' }]),
      'utf8'
    );

    let stagedCet4 = '';
    const outputZip = path.join(workspace, 'extension.zip');
    const runner = (command, args) => {
      if (command === 'zip') {
        stagedCet4 = fs.readFileSync(path.join(process.cwd(), 'data', 'cet4.json'), 'utf8');
        fs.writeFileSync(outputZip, 'zip', 'utf8');
        return { status: 0 };
      }
      if (command === 'unzip') {
        return {
          status: 0,
          stdout: `
Archive:  ${outputZip}
  Length      Date    Time    Name
---------  ---------- -----   ----
        34  2026-04-16 00:00   manifest.json
        0  2026-04-16 00:00   background.js
        0  2026-04-16 00:00   sharedSettings.js
        0  2026-04-16 00:00   runtimeMessaging.js
        0  2026-04-16 00:00   learningState.js
        0  2026-04-16 00:00   background-settings.js
        0  2026-04-16 00:00   background-storage.js
        0  2026-04-16 00:00   background-learning-state.js
        0  2026-04-16 00:00   background-message-handler.js
        0  2026-04-16 00:00   background-commands.js
        0  2026-04-16 00:00   contentScript/index.js
        0  2026-04-16 00:00   scripts/danmaku.js
        0  2026-04-16 00:00   scripts/scheduler.js
        7  2026-04-16 00:00   styles.css
      123  2026-04-16 00:00   dist/options.html
      456  2026-04-16 00:00   dist/assets/options.js
      456  2026-04-16 00:00   dist/assets/study-preview-chunk.js
      123  2026-04-16 00:00   dist/assets/study-preview.css
      123  2026-04-16 00:00   dist/popup.html
      456  2026-04-16 00:00   dist/assets/popup.js
      456  2026-04-16 00:00   dist/overlay.js
        0  2026-04-16 00:00   data/
---------                     -------
`,
        };
      }
      throw new Error(`Unexpected command ${command}`);
    };

    runPack({
      rootDir: workspace,
      platform: 'linux',
      runner,
      datasetRunner: spawnSync,
    });

    assert.match(stagedCet4, /publish-only/);
    assert.doesNotMatch(stagedCet4, /raw-data/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pack extension: parseZipEntryList should parse unzip output entries', () => {
  const entries = parseZipEntryList(`
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-04-16 00:00   dist/
      200  2026-04-16 00:00   dist/options.html
      123  2026-04-16 00:00   manifest.json
---------                     -------
`);

  assert.deepEqual(entries, ['dist/', 'dist/options.html', 'manifest.json']);
});

test('pack extension: parsePowerShellZipEntries should normalize backslashes', () => {
  const entries = parsePowerShellZipEntries('dist\\options.html\r\nmanifest.json\r\n');
  assert.deepEqual(entries, ['dist/options.html', 'manifest.json']);
});

test('pack extension: validateArchiveEntries should reject missing required paths', () => {
  assert.throws(
    () =>
      validateArchiveEntries('C:/tmp/extension.zip', {
        platform: 'linux',
        requiredEntries: ['dist', 'manifest.json', 'data'],
        runner: () => ({
          status: 0,
          stdout: `
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-04-16 00:00   dist/
      123  2026-04-16 00:00   manifest.json
---------                     -------
`,
        }),
      }),
    /Archive missing required entry: data/
  );
});

test('pack extension: validateArchiveEntries should require manifest-critical files by default', () => {
  assert.ok(REQUIRED_ARCHIVE_ENTRIES.includes(path.join('scripts', 'danmaku.js')));
  assert.throws(
    () =>
      validateArchiveEntries('C:/tmp/extension.zip', {
        platform: 'linux',
        runner: () => ({
          status: 0,
          stdout: `
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
      123  2026-04-16 00:00   manifest.json
       32  2026-04-16 00:00   background.js
       64  2026-04-16 00:00   contentScript/index.js
       17  2026-04-16 00:00   styles.css
        0  2026-04-16 00:00   dist/
        0  2026-04-16 00:00   data/
---------                     -------
`,
        }),
      }),
    /Archive missing required entry: scripts[\\/]danmaku\.js/
  );
});

test('pack extension: validateArchiveEntries should accept nested required paths', () => {
  const entries = validateArchiveEntries('C:/tmp/extension.zip', {
    platform: 'linux',
    requiredEntries: REQUIRED_ARCHIVE_ENTRIES,
    runner: () => ({
      status: 0,
      stdout: `
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
      123  2026-04-16 00:00   manifest.json
       32  2026-04-16 00:00   background.js
       32  2026-04-16 00:00   sharedSettings.js
       32  2026-04-16 00:00   runtimeMessaging.js
       32  2026-04-16 00:00   learningState.js
       32  2026-04-16 00:00   background-settings.js
       32  2026-04-16 00:00   background-storage.js
       32  2026-04-16 00:00   background-learning-state.js
       32  2026-04-16 00:00   background-message-handler.js
       32  2026-04-16 00:00   background-commands.js
       64  2026-04-16 00:00   contentScript/index.js
      456  2026-04-16 00:00   scripts/danmaku.js
      456  2026-04-16 00:00   scripts/scheduler.js
       17  2026-04-16 00:00   styles.css
      123  2026-04-16 00:00   dist/options.html
      123  2026-04-16 00:00   dist/popup.html
      456  2026-04-16 00:00   dist/overlay.js
      456  2026-04-16 00:00   data/cet4.json
---------                     -------
`,
    }),
  });

  assert.ok(entries.includes('data/cet4.json'));
  assert.ok(entries.includes('scripts/danmaku.js'));
});

test('pack extension: shouldRetryWindowsPack should match lock-related errors', () => {
  assert.equal(
    shouldRetryWindowsPack({
      status: 1,
      stderr:
        'ZipArchiveHelper : The process cannot access the file because it is being used by another process.',
    }),
    true
  );
  assert.equal(
    shouldRetryWindowsPack({
      status: 1,
      stderr: 'random failure',
    }),
    false
  );
});

test('pack extension: runPackCommandWithRetry should retry windows lock errors', () => {
  const calls = [];
  const result = runPackCommandWithRetry(
    {
      command: 'powershell',
      args: ['-NoProfile'],
      options: {},
    },
    {
      platform: 'win32',
      maxRetry: 2,
      runner: () => {
        const current = calls.length;
        calls.push(current);
        if (current === 0) {
          return {
            status: 1,
            stderr: 'CompressArchiveUnauthorizedAccessError: used by another process',
          };
        }
        return { status: 0, stderr: '' };
      },
    }
  );

  assert.equal(result.status, 0);
  assert.equal(calls.length, 2);
});
