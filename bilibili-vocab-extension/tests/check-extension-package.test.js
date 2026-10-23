const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ALLOWED_DATA_PACKAGE_ENTRIES,
  ALLOWED_DIST_PACKAGE_ENTRIES,
  DEFAULT_MAX_ENTRY_COUNT,
  DEFAULT_MAX_UNPACKED_SIZE_KB,
  DEFAULT_MAX_ZIP_SIZE_KB,
  FORBIDDEN_PACKAGE_ENTRIES,
  REQUIRED_STATIC_PACKAGE_ENTRIES,
  collectAllowedPackageEntries,
  collectManifestDistPackageEntries,
  collectManifestRuntimeEntries,
  collectPublishedDataPackageEntries,
  createReport,
  findForbiddenEntries,
  findMissingRequiredEntries,
  findUnexpectedDataEntries,
  findUnexpectedDistEntries,
  findUnexpectedPackageEntries,
  findUnexpectedRootRuntimeEntries,
  findUnexpectedScriptsRuntimeEntries,
  isForbiddenEntry,
  normalizeArchiveFileEntryNames,
  parseCliArgs,
  parsePowerShellZipEntryDetails,
  parseUnzipEntryDetails,
  runExtensionPackageCheck,
} = require('../scripts/check-extension-package.js');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'check-extension-package.js');
const EXPECTED_FORBIDDEN_PACKAGE_ENTRIES = [
  'dist/overlay-size-report.json',
  'scripts/build-vocab-dataset.js',
  'scripts/test',
  'tests',
  'react-ui/src',
  'sources',
  'node_modules',
];

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'extension-package-check-'));
}

function writeFakeZip(workspace, sizeInBytes = 4096) {
  const zipPath = path.join(workspace, 'extension.zip');
  fs.writeFileSync(zipPath, Buffer.alloc(sizeInBytes, 'z'));
  return zipPath;
}

function createRequiredPackageEntries(
  manifest = createRuntimeManifest(),
  allowedDistEntries = ALLOWED_DIST_PACKAGE_ENTRIES,
  options = {}
) {
  return collectAllowedPackageEntries({
    manifestRuntimeEntries: collectManifestRuntimeEntries(manifest, options),
    allowedDistEntries,
    allowedDataEntries: ALLOWED_DATA_PACKAGE_ENTRIES,
  });
}

function createEntryDetails(
  extraEntries = [],
  manifest = createRuntimeManifest(),
  allowedDistEntries = ALLOWED_DIST_PACKAGE_ENTRIES,
  options = {}
) {
  return createRequiredPackageEntries(manifest, allowedDistEntries, options)
    .concat(extraEntries)
    .map((name, index) => ({
      ...(typeof name === 'string' ? { name } : name),
      length: 512 + index,
      compressedLength: 128 + index,
    }));
}

function createRuntimeManifest() {
  return {
    background: { service_worker: 'background.js' },
    content_scripts: [
      {
        js: ['scripts/danmaku.js', 'scripts/scheduler.js', 'contentScript/index.js'],
        css: ['styles.css'],
      },
    ],
  };
}

function writeManifestProject(workspace, options = {}) {
  const optionsAsset = options.optionsAsset || 'options.js';
  const popupAsset = options.popupAsset || 'popup.js';

  fs.mkdirSync(path.join(workspace, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'manifest.json'),
    JSON.stringify(
      {
        ...createRuntimeManifest(),
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
  fs.writeFileSync(
    path.join(workspace, 'dist', 'options.html'),
    `<script type="module" src="./assets/${optionsAsset}"></script>`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workspace, 'dist', 'popup.html'),
    `<script type="module" src="./assets/${popupAsset}"></script>`,
    'utf8'
  );
}

function writeBackgroundImportScriptsFixture(workspace) {
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
  fs.writeFileSync(path.join(workspace, 'styles.css'), '', 'utf8');
  fs.mkdirSync(path.join(workspace, 'contentScript'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'contentScript', 'index.js'), '', 'utf8');
  fs.mkdirSync(path.join(workspace, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'scripts', 'danmaku.js'), '', 'utf8');
  fs.writeFileSync(path.join(workspace, 'scripts', 'scheduler.js'), '', 'utf8');
}

test('check extension package: should parse unzip entry details', () => {
  const entries = parseUnzipEntryDetails(`
Archive:  /tmp/extension.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-05-24 00:00   dist/
      123  2026-05-24 00:00   manifest.json
      456  2026-05-24 00:00   scripts/danmaku.js
---------                     -------
`);

  assert.deepEqual(entries, [
    { name: 'dist', length: 0, compressedLength: null, isDirectory: true },
    { name: 'manifest.json', length: 123, compressedLength: null },
    { name: 'scripts/danmaku.js', length: 456, compressedLength: null },
  ]);
  assert.deepEqual(normalizeArchiveFileEntryNames(entries), [
    'manifest.json',
    'scripts/danmaku.js',
  ]);
});

test('check extension package: should parse powershell entry details', () => {
  const entries = parsePowerShellZipEntryDetails(
    'dist\\options.html\t123\t45\r\nmanifest.json\t456\t78\r\n'
  );

  assert.deepEqual(entries, [
    { name: 'dist/options.html', length: 123, compressedLength: 45 },
    { name: 'manifest.json', length: 456, compressedLength: 78 },
  ]);
});

test('check extension package: should find missing required and nested forbidden entries', () => {
  const entryNames = [
    'manifest.json',
    'dist/options.html',
    'dist/overlay-size-report.json',
    'scripts/build-vocab-dataset.js',
    'scripts/test/00-setup-remote-env.sh',
    'tests/check-extension-package.test.js',
    'react-ui/src/components/options-main.tsx',
    'sources/ecdict.csv',
    'node_modules/pkg/index.js',
    'scripts/danmaku.js',
  ];

  assert.deepEqual(
    findMissingRequiredEntries(entryNames, ['manifest.json', 'contentScript/index.js']),
    ['contentScript/index.js']
  );
  assert.deepEqual(findForbiddenEntries(entryNames, FORBIDDEN_PACKAGE_ENTRIES), [
    'dist/overlay-size-report.json',
    'node_modules/pkg/index.js',
    'react-ui/src/components/options-main.tsx',
    'scripts/build-vocab-dataset.js',
    'scripts/test/00-setup-remote-env.sh',
    'sources/ecdict.csv',
    'tests/check-extension-package.test.js',
  ]);
  assert.equal(isForbiddenEntry('scripts/test/00-setup-remote-env.sh', 'scripts/test'), true);
  assert.equal(isForbiddenEntry('scripts/danmaku.js', 'scripts/test'), false);
  assert.equal(isForbiddenEntry('react-ui/dist/options.js', 'react-ui/src'), false);
});

test('check extension package: should reject dist entries outside the explicit allowlist', () => {
  const entryNames = [
    'manifest.json',
    'dist/options.html',
    'dist/assets/options.js',
    'dist/assets/debug.js',
    'dist/overlay-size-report.json',
    'scripts/danmaku.js',
  ];

  assert.deepEqual(findUnexpectedDistEntries(entryNames, ALLOWED_DIST_PACKAGE_ENTRIES), [
    'dist/assets/debug.js',
    'dist/overlay-size-report.json',
  ]);
});

test('check extension package: should reject data entries outside the explicit allowlist', () => {
  const entryNames = [
    'manifest.json',
    'data/cet4.json',
    'data/sources.json',
    'data/debug.json',
    'data/raw/snapshot.json',
  ];

  assert.deepEqual(findUnexpectedDataEntries(entryNames, ALLOWED_DATA_PACKAGE_ENTRIES), [
    'data/debug.json',
    'data/raw/snapshot.json',
  ]);
});

test('check extension package: should derive data package entries from vocabulary generator', () => {
  assert.deepEqual(collectPublishedDataPackageEntries(), [
    'data/cet4.json',
    'data/cet6.json',
    'data/kaoyan.json',
    'data/ielts.json',
    'data/toefl.json',
    'data/sources.json',
    'data/ATTRIBUTION.md',
  ]);
  assert.deepEqual(ALLOWED_DATA_PACKAGE_ENTRIES, collectPublishedDataPackageEntries());
});

test('check extension package: should derive root runtime entries from manifest', () => {
  assert.deepEqual(collectManifestRuntimeEntries(createRuntimeManifest()), [
    'background.js',
    'scripts/danmaku.js',
    'scripts/scheduler.js',
    'contentScript/index.js',
    'styles.css',
  ]);
});

test('check extension package: should include background importScripts dependencies in runtime entries', () => {
  const workspace = createTempDir();
  try {
    writeBackgroundImportScriptsFixture(workspace);

    assert.deepEqual(
      collectManifestRuntimeEntries(createRuntimeManifest(), { projectRoot: workspace }),
      [
        'background.js',
        'scripts/danmaku.js',
        'scripts/scheduler.js',
        'contentScript/index.js',
        'styles.css',
        'sharedSettings.js',
        'runtimeMessaging.js',
        'learningState.js',
        'background-settings.js',
        'background-storage.js',
        'background-learning-state.js',
        'background-message-handler.js',
        'background-commands.js',
      ]
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should reject scripts runtime entries outside manifest', () => {
  const entryNames = [
    'manifest.json',
    'background.js',
    'contentScript/index.js',
    'styles.css',
    'scripts/danmaku.js',
    'scripts/scheduler.js',
    'scripts/debug.js',
    'scripts/debug.css',
    'dist/overlay.js',
  ];

  assert.deepEqual(
    findUnexpectedScriptsRuntimeEntries(
      entryNames,
      collectManifestRuntimeEntries(createRuntimeManifest())
    ),
    ['scripts/debug.css', 'scripts/debug.js']
  );
});

test('check extension package: should reject root runtime entries outside manifest', () => {
  const entryNames = [
    'manifest.json',
    'background.js',
    'contentScript/index.js',
    'styles.css',
    'debug.css',
    'unused.js',
    'scripts/danmaku.js',
    'dist/overlay.js',
  ];

  assert.deepEqual(
    findUnexpectedRootRuntimeEntries(
      entryNames,
      collectManifestRuntimeEntries(createRuntimeManifest())
    ),
    ['debug.css', 'unused.js']
  );
});

test('check extension package: should reject package entries outside known release categories', () => {
  const manifestRuntimeEntries = collectManifestRuntimeEntries(createRuntimeManifest());
  const allowedPackageEntries = collectAllowedPackageEntries({
    manifestRuntimeEntries,
    allowedDistEntries: ALLOWED_DIST_PACKAGE_ENTRIES,
    allowedDataEntries: ALLOWED_DATA_PACKAGE_ENTRIES,
  });
  const entryNames = [...allowedPackageEntries, 'README.md', 'docs/report.md', 'test-output.txt'];

  assert.deepEqual(findUnexpectedPackageEntries(entryNames, allowedPackageEntries), [
    'README.md',
    'docs/report.md',
    'test-output.txt',
  ]);
});

test('check extension package: should derive dist package entries from manifest html assets', () => {
  const workspace = createTempDir();
  try {
    writeManifestProject(workspace, { optionsAsset: 'options.v2.js' });
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');
    const allowedDistEntries = collectManifestDistPackageEntries(workspace);

    assert.deepEqual(allowedDistEntries, [
      'dist/options.html',
      'dist/assets/options.v2.js',
      'dist/popup.html',
      'dist/assets/popup.js',
      'dist/overlay.js',
    ]);
    assert.equal(ALLOWED_DIST_PACKAGE_ENTRIES.includes('dist/assets/options.v2.js'), false);

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      entryDetails: createEntryDetails([], createRuntimeManifest(), allowedDistEntries),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'pass');
    assert.deepEqual(report.unexpectedDistEntries, []);
    assert.deepEqual(report.missingRequiredEntries, []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should write pass report for a clean package', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');
    const summaryFile = path.join(workspace, 'summary.md');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      summaryPath: summaryFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails(),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.file, 'extension.zip');
    assert.equal(report.result.overall, 'pass');
    assert.equal(report.actual.entries, createRequiredPackageEntries().length);
    assert.deepEqual(report.missingRequiredEntries, []);
    assert.deepEqual(report.forbiddenEntriesFound, []);
    assert.deepEqual(report.unexpectedDistEntries, []);
    assert.deepEqual(report.unexpectedDataEntries, []);
    assert.deepEqual(report.unexpectedRootRuntimeEntries, []);
    assert.deepEqual(report.unexpectedScriptsRuntimeEntries, []);
    assert.deepEqual(report.unexpectedPackageEntries, []);
    assert.ok(fs.existsSync(reportFile));
    assert.ok(fs.existsSync(summaryFile));
    assert.match(fs.readFileSync(summaryFile, 'utf8'), /Overall: PASS/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should require every manifest runtime entry by default', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');
    const manifest = {
      ...createRuntimeManifest(),
      content_scripts: [
        {
          js: [
            'scripts/danmaku.js',
            'scripts/scheduler.js',
            'contentScript/index.js',
            'runtimeExtra.js',
          ],
          css: ['styles.css'],
        },
      ],
    };

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      manifest,
      entryDetails: createEntryDetails([], createRuntimeManifest()),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.requiredEntries, 'fail');
    assert.deepEqual(report.missingRequiredEntries, ['runtimeExtra.js']);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should fail when background importScripts dependencies are missing from package', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');
    writeManifestProject(workspace);
    writeBackgroundImportScriptsFixture(workspace);

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      entryDetails: createEntryDetails([], createRuntimeManifest(), ALLOWED_DIST_PACKAGE_ENTRIES),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.requiredEntries, 'fail');
    assert.deepEqual(report.missingRequiredEntries, [
      'sharedSettings.js',
      'runtimeMessaging.js',
      'learningState.js',
      'background-settings.js',
      'background-storage.js',
      'background-learning-state.js',
      'background-message-handler.js',
      'background-commands.js',
    ]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should fail report when budgets or entry policy fail', () => {
  const report = createReport({
    packageFile: 'extension.zip',
    zipKb: 12,
    unpackedKb: 30,
    entryCount: 4,
    maxZipSizeKb: 10,
    maxUnpackedSizeKb: 20,
    maxEntryCount: 3,
    entryNames: ['manifest.json', 'dist/overlay-size-report.json'],
    missingRequiredEntries: ['contentScript.js'],
    forbiddenEntriesFound: ['dist/overlay-size-report.json'],
    unexpectedDistEntries: ['dist/overlay-size-report.json'],
    unexpectedDataEntries: ['data/debug.json'],
    unexpectedRootRuntimeEntries: ['unused.js'],
    unexpectedScriptsRuntimeEntries: ['scripts/debug.js'],
    unexpectedPackageEntries: ['README.md'],
  });

  assert.equal(report.result.zipSize, 'fail');
  assert.equal(report.result.unpackedSize, 'fail');
  assert.equal(report.result.entries, 'fail');
  assert.equal(report.result.requiredEntries, 'fail');
  assert.equal(report.result.forbiddenEntries, 'fail');
  assert.equal(report.result.distEntries, 'fail');
  assert.equal(report.result.dataEntries, 'fail');
  assert.equal(report.result.rootRuntimeEntries, 'fail');
  assert.equal(report.result.scriptsRuntimeEntries, 'fail');
  assert.equal(report.result.packageEntries, 'fail');
  assert.equal(report.result.overall, 'fail');
});

test('check extension package: should fail report when unexpected dist entries are present', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails(['dist/assets/debug.js']),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.distEntries, 'fail');
    assert.deepEqual(report.unexpectedDistEntries, ['dist/assets/debug.js']);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should write diagnostics when package policy fails', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');
    const summaryFile = path.join(workspace, 'summary.md');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      summaryPath: summaryFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails(['dist/overlay-size-report.json']),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.forbiddenEntries, 'fail');
    assert.equal(report.result.distEntries, 'fail');
    assert.ok(fs.existsSync(reportFile));
    assert.ok(fs.existsSync(summaryFile));
    assert.deepEqual(JSON.parse(fs.readFileSync(reportFile, 'utf8')).forbiddenEntriesFound, [
      'dist/overlay-size-report.json',
    ]);
    assert.match(fs.readFileSync(summaryFile, 'utf8'), /Forbidden entries found: 1/);
    assert.match(fs.readFileSync(summaryFile, 'utf8'), /Overall: FAIL/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should fail report when unexpected data entries are present', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails(['data/debug.json']),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.dataEntries, 'fail');
    assert.deepEqual(report.unexpectedDataEntries, ['data/debug.json']);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should fail report when root runtime entries are outside manifest', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails(['unused.js']),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.rootRuntimeEntries, 'fail');
    assert.deepEqual(report.unexpectedRootRuntimeEntries, ['unused.js']);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should fail report when scripts runtime entries are outside manifest', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails(['scripts/debug.js']),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.scriptsRuntimeEntries, 'fail');
    assert.deepEqual(report.unexpectedScriptsRuntimeEntries, ['scripts/debug.js']);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should fail report when package entries are outside known categories', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails(['README.md']),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'fail');
    assert.equal(report.result.packageEntries, 'fail');
    assert.deepEqual(report.unexpectedPackageEntries, ['README.md']);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should ignore zip directory entries in package policy', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace);
    const reportFile = path.join(workspace, 'reports', 'package-report.json');

    const { report } = runExtensionPackageCheck({
      packageFile: zipPath,
      reportFile,
      projectRoot: workspace,
      manifest: createRuntimeManifest(),
      entryDetails: createEntryDetails([
        { name: 'dist/', length: 0, compressedLength: null, isDirectory: true },
      ]),
      maxZipSizeKb: 10,
      maxUnpackedSizeKb: 20,
      maxEntryCount: 50,
    });

    assert.equal(report.result.overall, 'pass');
    assert.equal(report.result.packageEntries, 'pass');
    assert.deepEqual(report.unexpectedPackageEntries, []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: cli args should reject unknown options', () => {
  assert.deepEqual(parseCliArgs([]), {});
  assert.throws(
    () => parseCliArgs(['--package-file', 'custom.zip']),
    /Unknown extension package option: --package-file/
  );
});

test('check extension package: should reject invalid CLI budget', () => {
  const workspace = createTempDir();
  try {
    const zipPath = writeFakeZip(workspace, 256);
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      env: {
        ...process.env,
        EXTENSION_PACKAGE_FILE: zipPath,
        EXTENSION_PACKAGE_MAX_ZIP_KB: '0',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid extension zip size budget/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('check extension package: should expose conservative default budgets', () => {
  assert.equal(DEFAULT_MAX_ZIP_SIZE_KB, 3500);
  assert.equal(DEFAULT_MAX_UNPACKED_SIZE_KB, 19000);
  assert.equal(DEFAULT_MAX_ENTRY_COUNT, 80);
  assert.deepEqual(REQUIRED_STATIC_PACKAGE_ENTRIES, ['manifest.json']);
  assert.ok(createRequiredPackageEntries().includes('dist/overlay.js'));
  assert.ok(createRequiredPackageEntries().includes('dist/assets/use-undo-action-chunk.js'));
  assert.ok(createRequiredPackageEntries().includes('contentScript/index.js'));
  assert.deepEqual(ALLOWED_DIST_PACKAGE_ENTRIES, [
    'dist/options.html',
    'dist/popup.html',
    'dist/overlay.js',
    'dist/assets/options.js',
    'dist/assets/popup.js',
    'dist/assets/use-undo-action-chunk.js',
    'dist/assets/use-undo-action.css',
  ]);
  assert.deepEqual(ALLOWED_DATA_PACKAGE_ENTRIES, collectPublishedDataPackageEntries());
  assert.deepEqual(FORBIDDEN_PACKAGE_ENTRIES, EXPECTED_FORBIDDEN_PACKAGE_ENTRIES);
});
