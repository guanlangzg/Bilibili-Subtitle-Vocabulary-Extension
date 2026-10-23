const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listPublishedDataFileNames } = require('./build-vocab-dataset.js');
const {
  collectManifestPackEntries,
  collectRuntimeDependencyEntries,
} = require('./pack-extension.js');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_EXTENSION_ZIP_FILE = path.resolve(DEFAULT_PROJECT_ROOT, 'extension.zip');
const DEFAULT_REPORT_FILE = path.resolve(
  DEFAULT_PROJECT_ROOT,
  'test-results',
  'extension-package',
  'package-report.json'
);
const DEFAULT_MAX_ZIP_SIZE_KB = 3500;
const DEFAULT_MAX_UNPACKED_SIZE_KB = 19000;
const DEFAULT_MAX_ENTRY_COUNT = 80;
const REQUIRED_STATIC_PACKAGE_ENTRIES = ['manifest.json'];
// In-memory manifest checks lack built HTML; normal packaging derives these paths from it.
const ALLOWED_DIST_PACKAGE_ENTRIES = [
  'dist/options.html',
  'dist/popup.html',
  'dist/overlay.js',
  'dist/assets/options.js',
  'dist/assets/popup.js',
  'dist/assets/use-undo-action-chunk.js',
  'dist/assets/use-undo-action.css',
];
const ALLOWED_DATA_PACKAGE_ENTRIES = collectPublishedDataPackageEntries();
const FORBIDDEN_PACKAGE_ENTRIES = [
  'dist/overlay-size-report.json',
  'scripts/build-vocab-dataset.js',
  'scripts/test',
  'tests',
  'react-ui/src',
  'sources',
  'node_modules',
];
const ROOT_RUNTIME_ENTRY_EXTENSIONS = ['.js', '.css'];

const { parseBudget, toKb, toRoundedKb } = require('./lib/size-budget-utils.js');

function assertPositivePackageBudgets(maxZipSizeKb, maxUnpackedSizeKb, maxEntryCount) {
  if (!Number.isFinite(maxZipSizeKb) || maxZipSizeKb <= 0) {
    throw new Error(
      'Invalid extension zip size budget. Use EXTENSION_PACKAGE_MAX_ZIP_KB with a positive number.'
    );
  }
  if (!Number.isFinite(maxUnpackedSizeKb) || maxUnpackedSizeKb <= 0) {
    throw new Error(
      'Invalid extension unpacked size budget. Use EXTENSION_PACKAGE_MAX_UNPACKED_KB with a positive number.'
    );
  }
  if (!Number.isInteger(maxEntryCount) || maxEntryCount <= 0) {
    throw new Error(
      'Invalid extension entry count budget. Use EXTENSION_PACKAGE_MAX_ENTRIES with a positive integer.'
    );
  }
}

function normalizeArchiveEntryPath(entryPath) {
  return String(entryPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
}

function collectPublishedDataPackageEntries() {
  return listPublishedDataFileNames().map((fileName) =>
    normalizeArchiveEntryPath(path.posix.join('data', fileName))
  );
}

function isRawDirectoryEntryPath(entryPath) {
  return /[\\/]$/.test(String(entryPath || ''));
}

function createArchiveEntryDetail(rawName, length, compressedLength) {
  const entry = {
    name: normalizeArchiveEntryPath(rawName),
    length,
    compressedLength,
  };

  if (isRawDirectoryEntryPath(rawName)) {
    entry.isDirectory = true;
  }

  return entry;
}

function normalizeArchiveFileEntryNames(entryDetails) {
  return entryDetails
    .filter((entry) => entry && !entry.isDirectory)
    .map((entry) => normalizeArchiveEntryPath(entry.name))
    .filter(Boolean)
    .sort();
}

function readProjectManifest(projectRoot, manifestFile = 'manifest.json') {
  const manifestPath = path.resolve(projectRoot, manifestFile);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}. Package runtime policy requires manifest.json.`);
  }

  const raw = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function addUniqueEntry(entries, rawEntry) {
  const entry = normalizeArchiveEntryPath(rawEntry);
  if (entry && !entries.includes(entry)) {
    entries.push(entry);
  }
}

function collectManifestRuntimePathValues(entries, value) {
  if (typeof value === 'string') {
    addUniqueEntry(entries, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectManifestRuntimePathValues(entries, item));
  }
}

function collectManifestRuntimeEntries(manifest, options = {}) {
  const entries = [];
  collectManifestRuntimePathValues(
    entries,
    manifest && manifest.background && manifest.background.service_worker
  );

  const contentScripts =
    manifest && Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  contentScripts.forEach((script) => {
    collectManifestRuntimePathValues(entries, script && script.js);
    collectManifestRuntimePathValues(entries, script && script.css);
  });

  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : '';
  return projectRoot ? collectRuntimeDependencyEntries(projectRoot, entries) : entries;
}

function collectManifestDistPackageEntries(projectRoot, manifestFile = 'manifest.json') {
  return collectManifestPackEntries(projectRoot, manifestFile)
    .map(normalizeArchiveEntryPath)
    .filter((entry) => entry.startsWith('dist/'));
}

function resolveAllowedDistEntries(options, projectRoot, manifestFile) {
  if (options.allowedDistEntries) {
    return options.allowedDistEntries;
  }

  const manifestPath = path.resolve(projectRoot, manifestFile);
  if (!options.manifest || fs.existsSync(manifestPath)) {
    return collectManifestDistPackageEntries(projectRoot, manifestFile);
  }

  return ALLOWED_DIST_PACKAGE_ENTRIES;
}

function parseUnzipEntryDetails(stdoutText) {
  const entries = [];
  const lines = String(stdoutText || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith('Archive: ') ||
      line.startsWith('Length ') ||
      line.startsWith('---------')
    ) {
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 4 || !/^\d+$/.test(parts[0])) {
      continue;
    }

    entries.push(createArchiveEntryDetail(parts.slice(3).join(' '), Number(parts[0]), null));
  }

  return entries;
}

function parsePowerShellZipEntryDetails(stdoutText) {
  return String(stdoutText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, length, compressedLength] = line.split('\t');
      return createArchiveEntryDetail(name, Number(length), Number(compressedLength));
    })
    .filter((entry) => entry.name && Number.isFinite(entry.length));
}

function listArchiveEntryDetails(outputZipPath, options = {}) {
  const runner = options.runner || spawnSync;
  const platform = options.platform || process.platform;

  if (platform === 'win32') {
    const escapedPath = outputZipPath.replace(/'/g, "''");
    const command = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$zip=[System.IO.Compression.ZipFile]::OpenRead('${escapedPath}')`,
      '$zip.Entries | ForEach-Object { "$($_.FullName)`t$($_.Length)`t$($_.CompressedLength)" }',
      '$zip.Dispose()',
    ].join('; ');
    const result = runner(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8' }
    );

    if (!result || result.status !== 0) {
      const status = result && Number.isInteger(result.status) ? result.status : 1;
      throw new Error(
        `Failed to inspect extension archive entries on Windows (exit code ${status}).`
      );
    }

    return parsePowerShellZipEntryDetails(result.stdout);
  }

  const result = runner('unzip', ['-l', outputZipPath], { encoding: 'utf8' });
  if (!result || result.status !== 0) {
    const status = result && Number.isInteger(result.status) ? result.status : 1;
    throw new Error(`Failed to inspect extension archive entries (exit code ${status}).`);
  }

  return parseUnzipEntryDetails(result.stdout);
}

function isForbiddenEntry(entryName, forbiddenEntry) {
  const normalizedEntry = normalizeArchiveEntryPath(entryName);
  const normalizedForbidden = normalizeArchiveEntryPath(forbiddenEntry);
  return (
    normalizedEntry === normalizedForbidden || normalizedEntry.startsWith(`${normalizedForbidden}/`)
  );
}

function findMissingRequiredEntries(entryNames, requiredEntries) {
  const entrySet = new Set(entryNames.map(normalizeArchiveEntryPath));
  return requiredEntries
    .map(normalizeArchiveEntryPath)
    .filter((requiredEntry) => !entrySet.has(requiredEntry));
}

function findForbiddenEntries(entryNames, forbiddenEntries) {
  const matches = [];

  for (const entryName of entryNames) {
    for (const forbiddenEntry of forbiddenEntries) {
      if (isForbiddenEntry(entryName, forbiddenEntry) && !matches.includes(entryName)) {
        matches.push(entryName);
      }
    }
  }

  return matches.sort();
}

function findUnexpectedDistEntries(entryNames, allowedDistEntries) {
  const allowedSet = new Set(allowedDistEntries.map(normalizeArchiveEntryPath));
  return entryNames
    .map(normalizeArchiveEntryPath)
    .filter((entryName) => entryName.startsWith('dist/') && !allowedSet.has(entryName))
    .sort();
}

function findUnexpectedDataEntries(entryNames, allowedDataEntries) {
  const allowedSet = new Set(allowedDataEntries.map(normalizeArchiveEntryPath));
  return entryNames
    .map(normalizeArchiveEntryPath)
    .filter((entryName) => entryName.startsWith('data/') && !allowedSet.has(entryName))
    .sort();
}

function isRootRuntimeEntry(entryName) {
  const normalizedEntry = normalizeArchiveEntryPath(entryName);
  return (
    !normalizedEntry.includes('/') &&
    ROOT_RUNTIME_ENTRY_EXTENSIONS.includes(path.extname(normalizedEntry).toLowerCase())
  );
}

function findUnexpectedRootRuntimeEntries(entryNames, allowedRootRuntimeEntries) {
  const allowedSet = new Set(allowedRootRuntimeEntries.map(normalizeArchiveEntryPath));
  return entryNames
    .map(normalizeArchiveEntryPath)
    .filter((entryName) => isRootRuntimeEntry(entryName) && !allowedSet.has(entryName))
    .sort();
}

function isScriptsRuntimeEntry(entryName) {
  const normalizedEntry = normalizeArchiveEntryPath(entryName);
  return (
    normalizedEntry.startsWith('scripts/') &&
    ROOT_RUNTIME_ENTRY_EXTENSIONS.includes(path.extname(normalizedEntry).toLowerCase())
  );
}

function findUnexpectedScriptsRuntimeEntries(entryNames, allowedRuntimeEntries) {
  const allowedSet = new Set(allowedRuntimeEntries.map(normalizeArchiveEntryPath));
  return entryNames
    .map(normalizeArchiveEntryPath)
    .filter((entryName) => isScriptsRuntimeEntry(entryName) && !allowedSet.has(entryName))
    .sort();
}

function collectAllowedPackageEntries({
  manifestRuntimeEntries,
  allowedDistEntries,
  allowedDataEntries,
}) {
  const entries = [...REQUIRED_STATIC_PACKAGE_ENTRIES];
  manifestRuntimeEntries.forEach((entry) => addUniqueEntry(entries, entry));
  allowedDistEntries.forEach((entry) => addUniqueEntry(entries, entry));
  allowedDataEntries.forEach((entry) => addUniqueEntry(entries, entry));
  return entries;
}

function findUnexpectedPackageEntries(entryNames, allowedPackageEntries) {
  const allowedSet = new Set(allowedPackageEntries.map(normalizeArchiveEntryPath));
  return entryNames
    .map(normalizeArchiveEntryPath)
    .filter((entryName) => entryName && !allowedSet.has(entryName))
    .sort();
}

function evaluatePackage({
  zipKb,
  unpackedKb,
  entryCount,
  maxZipSizeKb,
  maxUnpackedSizeKb,
  maxEntryCount,
  missingRequiredEntries,
  forbiddenEntriesFound,
  unexpectedDistEntries = [],
  unexpectedDataEntries = [],
  unexpectedRootRuntimeEntries = [],
  unexpectedScriptsRuntimeEntries = [],
  unexpectedPackageEntries = [],
}) {
  const zipSize = zipKb <= maxZipSizeKb ? 'pass' : 'fail';
  const unpackedSize = unpackedKb <= maxUnpackedSizeKb ? 'pass' : 'fail';
  const entries = entryCount <= maxEntryCount ? 'pass' : 'fail';
  const requiredEntries = missingRequiredEntries.length === 0 ? 'pass' : 'fail';
  const forbiddenEntries = forbiddenEntriesFound.length === 0 ? 'pass' : 'fail';
  const distEntries = unexpectedDistEntries.length === 0 ? 'pass' : 'fail';
  const dataEntries = unexpectedDataEntries.length === 0 ? 'pass' : 'fail';
  const rootRuntimeEntries = unexpectedRootRuntimeEntries.length === 0 ? 'pass' : 'fail';
  const scriptsRuntimeEntries = unexpectedScriptsRuntimeEntries.length === 0 ? 'pass' : 'fail';
  const packageEntries = unexpectedPackageEntries.length === 0 ? 'pass' : 'fail';

  return {
    zipSize,
    unpackedSize,
    entries,
    requiredEntries,
    forbiddenEntries,
    distEntries,
    dataEntries,
    rootRuntimeEntries,
    scriptsRuntimeEntries,
    packageEntries,
    overall:
      zipSize === 'pass' &&
      unpackedSize === 'pass' &&
      entries === 'pass' &&
      requiredEntries === 'pass' &&
      forbiddenEntries === 'pass' &&
      distEntries === 'pass' &&
      dataEntries === 'pass' &&
      rootRuntimeEntries === 'pass' &&
      scriptsRuntimeEntries === 'pass' &&
      packageEntries === 'pass'
        ? 'pass'
        : 'fail',
  };
}

function createReport({
  packageFile,
  zipKb,
  unpackedKb,
  entryCount,
  maxZipSizeKb,
  maxUnpackedSizeKb,
  maxEntryCount,
  entryNames,
  missingRequiredEntries,
  forbiddenEntriesFound,
  unexpectedDistEntries = [],
  unexpectedDataEntries = [],
  unexpectedRootRuntimeEntries = [],
  unexpectedScriptsRuntimeEntries = [],
  unexpectedPackageEntries = [],
}) {
  return {
    checkedAt: new Date().toISOString(),
    file: packageFile,
    budget: {
      zipKb: maxZipSizeKb,
      unpackedKb: maxUnpackedSizeKb,
      entries: maxEntryCount,
    },
    actual: {
      zipKb,
      unpackedKb,
      entries: entryCount,
    },
    missingRequiredEntries,
    forbiddenEntriesFound,
    unexpectedDistEntries,
    unexpectedDataEntries,
    unexpectedRootRuntimeEntries,
    unexpectedScriptsRuntimeEntries,
    unexpectedPackageEntries,
    entries: entryNames,
    result: evaluatePackage({
      zipKb,
      unpackedKb,
      entryCount,
      maxZipSizeKb,
      maxUnpackedSizeKb,
      maxEntryCount,
      missingRequiredEntries,
      forbiddenEntriesFound,
      unexpectedDistEntries,
      unexpectedDataEntries,
      unexpectedRootRuntimeEntries,
      unexpectedScriptsRuntimeEntries,
      unexpectedPackageEntries,
    }),
  };
}

function writeGithubSummary(summaryPath, report) {
  if (!summaryPath) {
    return;
  }

  const lines = [
    '### Extension Package Gate',
    '',
    '| Metric | Actual | Budget | Result |',
    '| --- | ---: | ---: | --- |',
    `| Zip | ${report.actual.zipKb} KB | ${report.budget.zipKb} KB | ${report.result.zipSize === 'pass' ? 'OK' : 'Exceeded'} |`,
    `| Unpacked | ${report.actual.unpackedKb} KB | ${report.budget.unpackedKb} KB | ${report.result.unpackedSize === 'pass' ? 'OK' : 'Exceeded'} |`,
    `| Entries | ${report.actual.entries} | ${report.budget.entries} | ${report.result.entries === 'pass' ? 'OK' : 'Exceeded'} |`,
    '',
    `Missing required entries: ${report.missingRequiredEntries.length}`,
    `Forbidden entries found: ${report.forbiddenEntriesFound.length}`,
    `Unexpected dist entries found: ${report.unexpectedDistEntries.length}`,
    `Unexpected data entries found: ${report.unexpectedDataEntries.length}`,
    `Unexpected root runtime entries found: ${report.unexpectedRootRuntimeEntries.length}`,
    `Unexpected scripts runtime entries found: ${report.unexpectedScriptsRuntimeEntries.length}`,
    `Unexpected package entries found: ${report.unexpectedPackageEntries.length}`,
    '',
    `Overall: ${report.result.overall === 'pass' ? 'PASS' : 'FAIL'}`,
    '',
  ];

  try {
    fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn(
      `[extension-package-check] Failed to write GitHub summary: ${error && error.message ? error.message : error}`
    );
  }
}

function writePackageReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function runExtensionPackageCheck(options = {}) {
  const packageFile = path.resolve(
    options.packageFile || process.env.EXTENSION_PACKAGE_FILE || DEFAULT_EXTENSION_ZIP_FILE
  );
  const reportFile = path.resolve(
    options.reportFile || process.env.EXTENSION_PACKAGE_REPORT_FILE || DEFAULT_REPORT_FILE
  );
  const summaryPath = options.summaryPath || process.env.GITHUB_STEP_SUMMARY || '';
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const manifestFile = options.manifestFile || 'manifest.json';
  const maxZipSizeKb = parseBudget(
    options.maxZipSizeKb,
    parseBudget(process.env.EXTENSION_PACKAGE_MAX_ZIP_KB, DEFAULT_MAX_ZIP_SIZE_KB)
  );
  const maxUnpackedSizeKb = parseBudget(
    options.maxUnpackedSizeKb,
    parseBudget(process.env.EXTENSION_PACKAGE_MAX_UNPACKED_KB, DEFAULT_MAX_UNPACKED_SIZE_KB)
  );
  const maxEntryCount = parseBudget(
    options.maxEntryCount,
    parseBudget(process.env.EXTENSION_PACKAGE_MAX_ENTRIES, DEFAULT_MAX_ENTRY_COUNT)
  );

  assertPositivePackageBudgets(maxZipSizeKb, maxUnpackedSizeKb, maxEntryCount);

  if (!fs.existsSync(packageFile)) {
    throw new Error(`Missing ${packageFile}. Run 'pnpm run pack' before this check.`);
  }

  const entryDetails =
    options.entryDetails ||
    listArchiveEntryDetails(packageFile, {
      platform: options.platform,
      runner: options.runner,
    });
  const entryNames = normalizeArchiveFileEntryNames(entryDetails);
  const allowedDistEntries = resolveAllowedDistEntries(options, projectRoot, manifestFile);
  const allowedDataEntries = options.allowedDataEntries || ALLOWED_DATA_PACKAGE_ENTRIES;
  const manifest = options.manifest || readProjectManifest(projectRoot, manifestFile);
  const manifestRuntimeEntries =
    options.allowedRuntimeEntries || collectManifestRuntimeEntries(manifest, { projectRoot });
  const allowedPackageEntries =
    options.allowedPackageEntries ||
    collectAllowedPackageEntries({
      manifestRuntimeEntries,
      allowedDistEntries,
      allowedDataEntries,
    });
  const requiredPackageEntries = options.requiredEntries || allowedPackageEntries;
  const missingRequiredEntries = findMissingRequiredEntries(entryNames, requiredPackageEntries);
  const forbiddenEntriesFound = findForbiddenEntries(
    entryNames,
    options.forbiddenEntries || FORBIDDEN_PACKAGE_ENTRIES
  );
  const unexpectedDistEntries = findUnexpectedDistEntries(entryNames, allowedDistEntries);
  const unexpectedDataEntries = findUnexpectedDataEntries(entryNames, allowedDataEntries);
  const allowedRootRuntimeEntries = options.allowedRootRuntimeEntries || manifestRuntimeEntries;
  const allowedScriptsRuntimeEntries =
    options.allowedScriptsRuntimeEntries || manifestRuntimeEntries;
  const unexpectedRootRuntimeEntries = findUnexpectedRootRuntimeEntries(
    entryNames,
    allowedRootRuntimeEntries
  );
  const unexpectedScriptsRuntimeEntries = findUnexpectedScriptsRuntimeEntries(
    entryNames,
    allowedScriptsRuntimeEntries
  );
  const unexpectedPackageEntries = findUnexpectedPackageEntries(entryNames, allowedPackageEntries);
  const zipKb = toKb(fs.statSync(packageFile).size);
  const unpackedKb = toRoundedKb(
    toKb(entryDetails.reduce((sum, entry) => sum + Number(entry.length || 0), 0))
  );
  const report = createReport({
    packageFile: normalizeArchiveEntryPath(path.relative(projectRoot, packageFile)),
    zipKb,
    unpackedKb,
    entryCount: entryNames.length,
    maxZipSizeKb,
    maxUnpackedSizeKb,
    maxEntryCount,
    entryNames,
    missingRequiredEntries,
    forbiddenEntriesFound,
    unexpectedDistEntries,
    unexpectedDataEntries,
    unexpectedRootRuntimeEntries,
    unexpectedScriptsRuntimeEntries,
    unexpectedPackageEntries,
  });

  writeGithubSummary(summaryPath, report);
  writePackageReport(reportFile, report);

  return {
    packageFile,
    reportFile,
    report,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    return {};
  }

  throw new Error(`Unknown extension package option: ${argv[0]}`);
}

function runCli() {
  try {
    parseCliArgs();
    const { report } = runExtensionPackageCheck();
    console.log(
      `[extension-package-check] extension.zip zip=${report.actual.zipKb}KB (budget ${report.budget.zipKb}KB), unpacked=${report.actual.unpackedKb}KB (budget ${report.budget.unpackedKb}KB), entries=${report.actual.entries} (budget ${report.budget.entries})`
    );

    if (report.result.overall !== 'pass') {
      console.error('[extension-package-check] Extension package failed release gate.');
      if (report.missingRequiredEntries.length > 0) {
        console.error(
          `[extension-package-check] Missing required entries: ${report.missingRequiredEntries.join(', ')}`
        );
      }
      if (report.forbiddenEntriesFound.length > 0) {
        console.error(
          `[extension-package-check] Forbidden entries found: ${report.forbiddenEntriesFound.join(', ')}`
        );
      }
      if (report.unexpectedDistEntries.length > 0) {
        console.error(
          `[extension-package-check] Unexpected dist entries found: ${report.unexpectedDistEntries.join(', ')}`
        );
      }
      if (report.unexpectedDataEntries.length > 0) {
        console.error(
          `[extension-package-check] Unexpected data entries found: ${report.unexpectedDataEntries.join(', ')}`
        );
      }
      if (report.unexpectedRootRuntimeEntries.length > 0) {
        console.error(
          `[extension-package-check] Unexpected root runtime entries found: ${report.unexpectedRootRuntimeEntries.join(', ')}`
        );
      }
      if (report.unexpectedScriptsRuntimeEntries.length > 0) {
        console.error(
          `[extension-package-check] Unexpected scripts runtime entries found: ${report.unexpectedScriptsRuntimeEntries.join(', ')}`
        );
      }
      if (report.unexpectedPackageEntries.length > 0) {
        console.error(
          `[extension-package-check] Unexpected package entries found: ${report.unexpectedPackageEntries.join(', ')}`
        );
      }
      process.exit(1);
    }

    console.log('[extension-package-check] Passed.');
  } catch (error) {
    console.error(`[extension-package-check] ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_PROJECT_ROOT,
  DEFAULT_EXTENSION_ZIP_FILE,
  DEFAULT_REPORT_FILE,
  DEFAULT_MAX_ZIP_SIZE_KB,
  DEFAULT_MAX_UNPACKED_SIZE_KB,
  DEFAULT_MAX_ENTRY_COUNT,
  ALLOWED_DIST_PACKAGE_ENTRIES,
  ALLOWED_DATA_PACKAGE_ENTRIES,
  REQUIRED_STATIC_PACKAGE_ENTRIES,
  FORBIDDEN_PACKAGE_ENTRIES,
  parseBudget,
  toKb,
  normalizeArchiveEntryPath,
  normalizeArchiveFileEntryNames,
  readProjectManifest,
  collectManifestRuntimeEntries,
  collectManifestDistPackageEntries,
  collectPublishedDataPackageEntries,
  parseUnzipEntryDetails,
  parsePowerShellZipEntryDetails,
  listArchiveEntryDetails,
  isForbiddenEntry,
  findMissingRequiredEntries,
  findForbiddenEntries,
  findUnexpectedDistEntries,
  findUnexpectedDataEntries,
  findUnexpectedRootRuntimeEntries,
  findUnexpectedScriptsRuntimeEntries,
  collectAllowedPackageEntries,
  findUnexpectedPackageEntries,
  evaluatePackage,
  createReport,
  parseCliArgs,
  runExtensionPackageCheck,
};
