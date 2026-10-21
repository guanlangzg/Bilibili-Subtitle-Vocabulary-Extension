const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const BUILD_VOCAB_DATASET_SCRIPT = path.join('scripts', 'build-vocab-dataset.js');
const DEFAULT_OUTPUT_NAME = 'extension.zip';
const DEFAULT_INCLUDE_GLOBS = [];
const EXCLUDED_PUBLISH_ENTRIES = ['dist/overlay-size-report.json'];
const EXCLUDED_PUBLISH_PREFIXES = ['legacy/'];
const FIXED_INCLUDE_PATHS = [
  'manifest.json',
  'background.js',
  path.join('contentScript', 'index.js'),
  'styles.css',
  path.join('scripts', 'danmaku.js'),
  path.join('scripts', 'scheduler.js'),
  'dist/options.html',
  'dist/popup.html',
  'dist/overlay.js',
  'data',
];
const WIN_ARCHIVE_SCRIPT_FILE = 'pack-extension.ps1';
const REQUIRED_ARCHIVE_ENTRIES = FIXED_INCLUDE_PATHS.slice();
const WINDOWS_PACK_MAX_RETRY = 2;
const HTML_REFERENCE_ATTRIBUTE_PATTERN = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const EXTERNAL_HTML_REFERENCE_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;
const IMPORT_SCRIPTS_CALL_PATTERN = /\bimportScripts\s*\(([\s\S]*?)\)/gi;
const STRING_LITERAL_PATTERN = /(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g;

function listProjectRootFiles(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true }).map((entry) => entry.name);
}

function resolveGlobMatches(rootDir, patterns = DEFAULT_INCLUDE_GLOBS) {
  const rootNames = listProjectRootFiles(rootDir);
  const matches = [];

  for (const pattern of patterns) {
    if (!pattern.startsWith('*.')) {
      continue;
    }

    const ext = pattern.slice(1).toLowerCase();
    for (const name of rootNames) {
      if (!name.toLowerCase().endsWith(ext)) {
        continue;
      }
      if (!matches.includes(name)) {
        matches.push(name);
      }
    }
  }

  return matches;
}

function collectPackEntries(rootDir, options = {}) {
  const fixedPaths =
    options.fixedPaths || collectManifestPackEntries(rootDir, options.manifestFile);
  const requiredFixedPaths = options.requiredFixedPaths || fixedPaths;
  const globPatterns = options.globPatterns || DEFAULT_INCLUDE_GLOBS;
  const entries = [];

  for (const fixedPath of fixedPaths) {
    const absolute = path.resolve(rootDir, fixedPath);
    if (!fs.existsSync(absolute)) {
      if (requiredFixedPaths.includes(fixedPath)) {
        throw new Error(`Pack entry missing required path: ${fixedPath}`);
      }
      continue;
    }
    if (!entries.includes(fixedPath)) {
      entries.push(fixedPath);
    }
  }

  const globEntries = resolveGlobMatches(rootDir, globPatterns);
  for (const entry of globEntries) {
    if (!entries.includes(entry)) {
      entries.push(entry);
    }
  }

  return entries;
}

function normalizeOutputZipPath(rootDir, outputZip) {
  const outputName = outputZip || process.env.EXTENSION_ZIP_NAME || DEFAULT_OUTPUT_NAME;
  return path.resolve(rootDir, outputName);
}

function copyEntryToDirectory(rootDir, stagingRoot, entry) {
  const sourcePath = path.resolve(rootDir, entry);
  const targetPath = path.resolve(stagingRoot, entry);
  if (shouldExcludePublishEntry(rootDir, sourcePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    filter: (source) => !shouldExcludePublishEntry(rootDir, source),
  });
}

function collectArchiveRoots(entries) {
  const roots = [];

  for (const entry of entries) {
    const normalizedEntry = normalizeArchivePathForCheck(entry);
    const root = normalizedEntry.includes('/') ? normalizedEntry.split('/')[0] : normalizedEntry;

    if (root && !roots.includes(root)) {
      roots.push(root);
    }
  }

  return roots;
}

function shouldStagePublishData(rootDir, options = {}) {
  if (options.stagePublishData === false) {
    return false;
  }

  return (
    fs.existsSync(path.join(rootDir, 'sources')) &&
    fs.existsSync(path.join(rootDir, BUILD_VOCAB_DATASET_SCRIPT))
  );
}

function buildPublishDataset(stagingRoot, rootDir, options = {}) {
  const datasetRunner = options.datasetRunner || spawnSync;
  const dataDir = path.join(stagingRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const result = datasetRunner(
    process.execPath,
    [BUILD_VOCAB_DATASET_SCRIPT, '--publish-safe', '--output-dir', dataDir],
    {
      cwd: rootDir,
      stdio: 'inherit',
    }
  );

  if (!result || result.status !== 0) {
    const status = result && Number.isInteger(result.status) ? result.status : 1;
    throw new Error(`Publish dataset build failed with exit code ${status}.`);
  }
}

function createPackStageRoot(rootDir, entries, options = {}) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-pack-root-'));
  const stagePublishData = shouldStagePublishData(rootDir, options);

  for (const entry of entries) {
    if (entry === 'data') {
      continue;
    }
    copyEntryToDirectory(rootDir, stagingRoot, entry);
  }

  if (entries.includes('data') && stagePublishData) {
    buildPublishDataset(stagingRoot, rootDir, options);
  } else if (entries.includes('data')) {
    copyEntryToDirectory(rootDir, stagingRoot, 'data');
  }

  return stagingRoot;
}

function normalizeArchivePathForCheck(entryPath) {
  return entryPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function normalizeProjectRelativePath(rootDir, filePath) {
  return normalizeArchivePathForCheck(path.relative(rootDir, filePath));
}

function shouldExcludePublishEntry(rootDir, filePath) {
  const relativePath = normalizeProjectRelativePath(rootDir, filePath);
  if (EXCLUDED_PUBLISH_ENTRIES.includes(relativePath)) {
    return true;
  }
  return EXCLUDED_PUBLISH_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function readManifest(rootDir, manifestFile = 'manifest.json') {
  const manifestPath = path.resolve(rootDir, manifestFile);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Pack entry missing required path: ${manifestFile}`);
  }

  const raw = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function getWildcardArchiveRoot(normalizedPath) {
  const wildcardIndex = normalizedPath.indexOf('*');
  if (wildcardIndex === -1) {
    return '';
  }

  const prefix = normalizedPath.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf('/');
  return slashIndex === -1 ? prefix : prefix.slice(0, slashIndex);
}

function addUniqueEntry(entries, entry) {
  if (entry && !entries.includes(entry)) {
    entries.push(entry);
  }
}

function stripHtmlReferenceSuffix(rawReference) {
  const reference = String(rawReference || '').trim();
  const suffixIndex = reference.search(/[?#]/);
  return suffixIndex === -1 ? reference : reference.slice(0, suffixIndex);
}

function resolveRuntimeScriptReference(fromEntry, rawReference) {
  const reference = stripHtmlReferenceSuffix(rawReference);
  if (!reference || EXTERNAL_HTML_REFERENCE_PATTERN.test(reference)) {
    return '';
  }

  const normalizedFromEntry = normalizeArchivePathForCheck(fromEntry);
  const joinedReference = reference.startsWith('/')
    ? reference.replace(/^\/+/, '')
    : path.posix.join(path.posix.dirname(normalizedFromEntry), reference);
  const normalizedReference = normalizeArchivePathForCheck(path.posix.normalize(joinedReference));

  if (
    !normalizedReference ||
    normalizedReference === '..' ||
    normalizedReference.startsWith('../')
  ) {
    return '';
  }

  return normalizedReference;
}

function extractImportScriptsReferences(sourceText) {
  const references = [];
  let callMatch = null;

  IMPORT_SCRIPTS_CALL_PATTERN.lastIndex = 0;
  while ((callMatch = IMPORT_SCRIPTS_CALL_PATTERN.exec(String(sourceText || ''))) !== null) {
    const argsSource = callMatch[1] || '';
    let literalMatch = null;
    STRING_LITERAL_PATTERN.lastIndex = 0;

    while ((literalMatch = STRING_LITERAL_PATTERN.exec(argsSource)) !== null) {
      const reference = literalMatch[2];
      if (reference && !references.includes(reference)) {
        references.push(reference);
      }
    }
  }

  return references;
}

function collectImportScriptDependencies(rootDir, entryPath, visitedEntries = new Set()) {
  const normalizedEntry = normalizeArchivePathForCheck(entryPath);
  if (!normalizedEntry || visitedEntries.has(normalizedEntry)) {
    return [];
  }

  visitedEntries.add(normalizedEntry);
  const absolutePath = path.resolve(rootDir, normalizedEntry);
  if (!fs.existsSync(absolutePath) || path.extname(normalizedEntry).toLowerCase() !== '.js') {
    return [];
  }

  const sourceText = fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '');
  const dependencies = [];

  extractImportScriptsReferences(sourceText).forEach((reference) => {
    const dependencyEntry = resolveRuntimeScriptReference(normalizedEntry, reference);
    if (!dependencyEntry) {
      return;
    }

    addUniqueEntry(dependencies, dependencyEntry);
    collectImportScriptDependencies(rootDir, dependencyEntry, visitedEntries).forEach(
      (nestedDependency) => {
        addUniqueEntry(dependencies, nestedDependency);
      }
    );
  });

  return dependencies;
}

function collectRuntimeDependencyEntries(rootDir, baseEntries) {
  const entries = [];
  const runtimeVisitedEntries = new Set();

  (Array.isArray(baseEntries) ? baseEntries : []).forEach((entry) => {
    addUniqueEntry(entries, entry);
  });

  entries.slice().forEach((entry) => {
    collectImportScriptDependencies(rootDir, entry, runtimeVisitedEntries).forEach((dependency) => {
      addUniqueEntry(entries, dependency);
    });
  });

  return entries;
}

function resolveHtmlReferenceEntry(htmlEntry, rawReference) {
  const reference = stripHtmlReferenceSuffix(rawReference);
  if (!reference || EXTERNAL_HTML_REFERENCE_PATTERN.test(reference)) {
    return '';
  }

  const normalizedHtmlEntry = normalizeArchivePathForCheck(htmlEntry);
  const joinedReference = reference.startsWith('/')
    ? reference.replace(/^\/+/, '')
    : path.posix.join(path.posix.dirname(normalizedHtmlEntry), reference);
  const normalizedReference = normalizeArchivePathForCheck(path.posix.normalize(joinedReference));

  if (
    !normalizedReference ||
    normalizedReference === '..' ||
    normalizedReference.startsWith('../')
  ) {
    return '';
  }

  return normalizedReference;
}

function collectHtmlAssetReferences(rootDir, htmlEntry) {
  const htmlPath = path.resolve(rootDir, htmlEntry);
  if (!fs.existsSync(htmlPath)) {
    return [];
  }

  const htmlSource = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
  const references = [];
  let match = null;
  HTML_REFERENCE_ATTRIBUTE_PATTERN.lastIndex = 0;

  while ((match = HTML_REFERENCE_ATTRIBUTE_PATTERN.exec(htmlSource)) !== null) {
    const entry = resolveHtmlReferenceEntry(htmlEntry, match[1] || match[2] || match[3]);
    if (entry !== normalizeArchivePathForCheck(htmlEntry)) {
      addUniqueEntry(references, entry);
    }
  }

  return references;
}

function collectManifestEntry(rootDir, entries, rawPath) {
  const normalizedPath = normalizeArchivePathForCheck(String(rawPath || '').trim());
  if (!normalizedPath) {
    return;
  }

  const wildcardRoot = getWildcardArchiveRoot(normalizedPath);
  const normalizedEntry = wildcardRoot || normalizedPath;

  addUniqueEntry(entries, normalizedEntry);

  if (wildcardRoot || !normalizedEntry.toLowerCase().endsWith('.html')) {
    return;
  }

  for (const assetEntry of collectHtmlAssetReferences(rootDir, normalizedEntry)) {
    addUniqueEntry(entries, assetEntry);
  }
}

function collectManifestPathValues(rootDir, entries, value) {
  if (typeof value === 'string') {
    collectManifestEntry(rootDir, entries, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectManifestPathValues(rootDir, entries, item));
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectManifestPathValues(rootDir, entries, item));
  }
}

function collectManifestPackEntries(rootDir, manifestFile = 'manifest.json') {
  const manifest = readManifest(rootDir, manifestFile);
  const entries = ['manifest.json'];

  collectManifestPathValues(
    rootDir,
    entries,
    manifest.background && manifest.background.service_worker
  );

  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  contentScripts.forEach((script) => {
    collectManifestPathValues(rootDir, entries, script && script.js);
    collectManifestPathValues(rootDir, entries, script && script.css);
  });

  collectManifestPathValues(rootDir, entries, manifest.options_page);
  collectManifestPathValues(rootDir, entries, manifest.action && manifest.action.default_popup);
  collectManifestPathValues(rootDir, entries, manifest.action && manifest.action.default_icon);
  collectManifestPathValues(rootDir, entries, manifest.icons);

  const webAccessibleResources = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  webAccessibleResources.forEach((item) => {
    collectManifestPathValues(rootDir, entries, item && item.resources);
  });

  // Vocabulary JSON is fetched by content scripts via chrome.runtime.getURL with
  // the page origin, so it must stay listed in web_accessible_resources (MV3).
  if (fs.existsSync(path.join(rootDir, 'data')) && !entries.includes('data')) {
    entries.push('data');
  }

  return collectRuntimeDependencyEntries(rootDir, entries);
}

function parseZipEntryList(stdoutText) {
  const lines = String(stdoutText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    if (
      !line.startsWith('Archive: ') &&
      !line.startsWith('Length ') &&
      !line.startsWith('---------')
    ) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        entries.push(parts[parts.length - 1]);
      }
    }
  }

  return entries;
}

function parsePowerShellZipEntries(stdoutText) {
  return String(stdoutText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
}

function listArchiveEntries(outputZipPath, options = {}) {
  const runner = options.runner || spawnSync;
  const platform = options.platform || process.platform;

  if (platform === 'win32') {
    const result = runner(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::OpenRead('${outputZipPath.replace(/'/g, "''")}'); $zip.Entries | ForEach-Object { $_.FullName }; $zip.Dispose()`,
      ],
      {
        encoding: 'utf8',
      }
    );

    if (result.status !== 0) {
      throw new Error(`Failed to inspect archive entries on Windows (exit code ${result.status}).`);
    }

    return parsePowerShellZipEntries(result.stdout);
  }

  const result = runner('unzip', ['-l', outputZipPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to inspect archive entries (exit code ${result.status}).`);
  }

  return parseZipEntryList(result.stdout);
}

function validateArchiveEntries(outputZipPath, options = {}) {
  const requiredEntries = options.requiredEntries || REQUIRED_ARCHIVE_ENTRIES;
  const entries = listArchiveEntries(outputZipPath, options);
  const normalizedEntries = entries.map(normalizeArchivePathForCheck);

  for (const requiredEntry of requiredEntries) {
    const normalizedRequired = normalizeArchivePathForCheck(requiredEntry);
    const exactHit = normalizedEntries.includes(normalizedRequired);
    const nestedHit = normalizedEntries.some((entry) => entry.startsWith(`${normalizedRequired}/`));

    if (!exactHit && !nestedHit) {
      throw new Error(`Archive missing required entry: ${requiredEntry}`);
    }
  }

  return entries;
}

function buildPosixZipCommand(outputZipPath, entries) {
  return {
    command: 'zip',
    args: ['-r', outputZipPath, ...entries],
    options: { stdio: 'inherit' },
  };
}

function buildWindowsArchiveScript(outputZipPath, entries) {
  const escapedOutput = outputZipPath.replace(/'/g, "''");
  const escapedEntries = entries.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(', ');

  return [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath '${process.cwd().replace(/'/g, "''")}'`,
    `if (Test-Path -LiteralPath '${escapedOutput}') { Remove-Item -LiteralPath '${escapedOutput}' -Force }`,
    `$entries = @(${escapedEntries})`,
    '$existing = @()',
    'foreach ($item in $entries) {',
    '  if (Test-Path -LiteralPath $item) { $existing += $item }',
    '}',
    "if ($existing.Count -eq 0) { throw 'No files matched for packaging.' }",
    `Compress-Archive -Path $existing -DestinationPath '${escapedOutput}' -Force`,
  ].join('\n');
}

function shouldRetryWindowsPack(result) {
  if (!result || result.status === 0) {
    return false;
  }
  const stderr = String(result.stderr || '');
  const stdout = String(result.stdout || '');
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes('because it is being used by another process') ||
    combined.includes('compressarchiveunauthorizedaccesserror')
  );
}

function sleepSync(milliseconds) {
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitArray, 0, 0, milliseconds);
}

function runPackCommandWithRetry(commandSpec, options = {}) {
  const runner = options.runner || spawnSync;
  const platform = options.platform || process.platform;
  const maxRetry = Number.isInteger(options.maxRetry) ? options.maxRetry : WINDOWS_PACK_MAX_RETRY;

  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    const result = runner(commandSpec.command, commandSpec.args, commandSpec.options);
    lastResult = result;
    if (result.status === 0) {
      return result;
    }

    const canRetry = platform === 'win32' && shouldRetryWindowsPack(result) && attempt < maxRetry;
    if (!canRetry) {
      return result;
    }

    sleepSync(150 * (attempt + 1));
  }

  return lastResult || { status: 1 };
}

function buildWindowsZipCommand(outputZipPath, entries, tempDir) {
  const scriptPath = path.join(tempDir, WIN_ARCHIVE_SCRIPT_FILE);
  const script = buildWindowsArchiveScript(outputZipPath, entries);
  fs.writeFileSync(scriptPath, script, 'utf8');

  return {
    command: 'powershell',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    options: { stdio: 'inherit' },
  };
}

function createZipCommand(rootDir, outputZipPath, entries, options = {}) {
  const platform = options.platform || process.platform;

  if (platform === 'win32') {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-pack-'));
    const command = buildWindowsZipCommand(outputZipPath, entries, tempDir);
    return {
      ...command,
      cleanup: () => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      },
    };
  }

  return {
    ...buildPosixZipCommand(outputZipPath, entries),
    cleanup: null,
  };
}

function runPack(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.resolve(__dirname, '..'));
  const outputZipPath = normalizeOutputZipPath(rootDir, options.outputZip);
  const entries = collectPackEntries(rootDir, options);

  if (entries.length === 0) {
    throw new Error('No files matched for packaging.');
  }

  const runner = options.runner || spawnSync;
  const inspectorRunner = options.inspectorRunner || runner;
  const originalCwd = process.cwd();

  let cleanup = null;
  try {
    const packRoot = createPackStageRoot(rootDir, entries, options);
    const archiveRoots = collectArchiveRoots(entries);
    cleanup = () => {
      fs.rmSync(packRoot, { recursive: true, force: true });
    };
    process.chdir(packRoot);

    if (fs.existsSync(outputZipPath)) {
      fs.rmSync(outputZipPath, { force: true });
    }

    const commandSpec = createZipCommand(packRoot, outputZipPath, archiveRoots, options);
    const commandCleanup = commandSpec.cleanup;
    cleanup = () => {
      if (typeof commandCleanup === 'function') {
        commandCleanup();
      }
      fs.rmSync(packRoot, { recursive: true, force: true });
    };
    const result = runPackCommandWithRetry(commandSpec, {
      runner,
      platform: options.platform,
      maxRetry: options.maxRetry,
    });

    if (result.status !== 0) {
      throw new Error(`Pack command failed with exit code ${result.status}.`);
    }

    if (!fs.existsSync(outputZipPath)) {
      throw new Error(`Pack command finished but archive was not created: ${outputZipPath}`);
    }

    const archiveEntries = validateArchiveEntries(outputZipPath, {
      platform: options.platform,
      runner: inspectorRunner,
      requiredEntries: options.requiredEntries || entries,
    });

    return {
      rootDir,
      packRoot,
      outputZipPath,
      entries,
      archiveRoots,
      archiveEntries,
      command: commandSpec.command,
      args: commandSpec.args,
    };
  } finally {
    process.chdir(originalCwd);
    if (typeof cleanup === 'function') {
      cleanup();
    }
  }
}

function parseCliArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    return {};
  }

  throw new Error(`Unknown pack option: ${argv[0]}`);
}

function runCli() {
  try {
    parseCliArgs();
    const result = runPack();
    console.log(`[pack] Created ${result.outputZipPath}`);
  } catch (error) {
    console.error(`[pack] ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_OUTPUT_NAME,
  DEFAULT_INCLUDE_GLOBS,
  FIXED_INCLUDE_PATHS,
  EXCLUDED_PUBLISH_ENTRIES,
  EXCLUDED_PUBLISH_PREFIXES,
  WIN_ARCHIVE_SCRIPT_FILE,
  REQUIRED_ARCHIVE_ENTRIES,
  WINDOWS_PACK_MAX_RETRY,
  collectPackEntries,
  collectManifestPackEntries,
  collectRuntimeDependencyEntries,
  collectImportScriptDependencies,
  extractImportScriptsReferences,
  collectHtmlAssetReferences,
  normalizeOutputZipPath,
  normalizeArchivePathForCheck,
  shouldExcludePublishEntry,
  parseZipEntryList,
  parsePowerShellZipEntries,
  collectArchiveRoots,
  listArchiveEntries,
  validateArchiveEntries,
  buildPosixZipCommand,
  buildWindowsArchiveScript,
  shouldRetryWindowsPack,
  runPackCommandWithRetry,
  createZipCommand,
  createPackStageRoot,
  parseCliArgs,
  runPack,
};
