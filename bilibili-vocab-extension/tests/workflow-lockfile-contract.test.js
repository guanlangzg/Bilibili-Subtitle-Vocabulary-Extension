const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readWorkflow(fileName) {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', fileName),
    'utf8'
  );
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
}

function readLockfile() {
  return fs.readFileSync(path.join(__dirname, '..', 'pnpm-lock.yaml'), 'utf8');
}

function getPackageManagerPnpmMajor(packageJson) {
  const match = /^pnpm@(\d+)\.\d+\.\d+$/.exec(String(packageJson.packageManager || ''));
  assert.ok(match, `Expected packageManager to pin pnpm semver, got ${packageJson.packageManager}`);
  return match[1];
}

function getPnpmLockfileMajor(lockfileText) {
  const match = /^lockfileVersion:\s*'(\d+)\.\d+'\s*$/m.exec(lockfileText);
  assert.ok(match, 'Expected pnpm-lock.yaml to pin lockfileVersion.');
  return match[1];
}

function collectPnpmInstallCommands(workflowText) {
  const matches = workflowText.match(/run:\s*pnpm install[^\r\n]*/g);
  return Array.isArray(matches) ? matches : [];
}

function collectUploadArtifactNames(workflowText) {
  const uploadBlocks = workflowText.match(
    /uses:\s*actions\/upload-artifact@v4[\s\S]*?(?=\n\s*-\s+name:|\n\s{2}[a-zA-Z0-9_-]+:\n|$)/g
  );
  return (uploadBlocks || []).map((block) => {
    const match = block.match(/\n\s+name:\s*([^\r\n]+)/);
    assert.ok(match, `Missing artifact name in block:\n${block}`);
    return match[1].trim();
  });
}

function collectWorkflowUses(workflowText) {
  const uses = [];
  const normalized = workflowText.replace(/\r\n/g, '\n');
  const pattern = /^\s+uses:\s*([^\s]+)/gm;
  let match = pattern.exec(normalized);

  while (match) {
    uses.push(match[1]);
    match = pattern.exec(normalized);
  }

  return uses;
}

function collectCheckoutBlocks(workflowText) {
  return (
    workflowText
      .replace(/\r\n/g, '\n')
      .match(
        /uses:\s*actions\/checkout@v4[\s\S]*?(?=\n\s*-\s+name:|\n\s{2}[a-zA-Z0-9_-]+:\n|$)/g
      ) || []
  );
}

function readTopLevelBlock(workflowText, blockName) {
  const normalized = workflowText.replace(/\r\n/g, '\n');
  const marker = `${blockName}:\n`;
  const start = normalized.indexOf(marker);
  assert.notEqual(start, -1, `Missing top-level block: ${blockName}`);

  const rest = normalized.slice(start + marker.length);
  const nextBlockMatch = rest.match(/\n[a-zA-Z0-9_-]+:\n/);
  return nextBlockMatch ? rest.slice(0, nextBlockMatch.index) : rest;
}

function readWorkflowJob(workflowText, jobName) {
  const normalized = workflowText.replace(/\r\n/g, '\n');
  const marker = `\n  ${jobName}:\n`;
  const start = normalized.indexOf(marker);
  assert.notEqual(start, -1, `Missing workflow job: ${jobName}`);

  const rest = normalized.slice(start + marker.length);
  const nextJobMatch = rest.match(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJobMatch ? rest.slice(0, nextJobMatch.index) : rest;
}

test('workflow lockfile contract: ci workflow should freeze pnpm lockfile installs', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'pnpm-lock.yaml')), true);
  assert.equal(
    fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8').includes('pnpm-lock.yaml'),
    false
  );

  const workflow = readWorkflow('ci.yml');
  const installCommands = collectPnpmInstallCommands(workflow);

  assert.equal(installCommands.length, 5);
  assert.doesNotMatch(workflow, /--no-frozen-lockfile/);
  assert.doesNotMatch(
    workflow,
    /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/package\.json/
  );
  assert.match(workflow, /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/pnpm-lock\.yaml/);
  for (const command of installCommands) {
    assert.match(command, /--frozen-lockfile/);
  }
});

test('workflow lockfile contract: lockfile major should match packageManager pnpm major', () => {
  assert.equal(getPnpmLockfileMajor(readLockfile()), getPackageManagerPnpmMajor(readPackageJson()));
});

test('workflow lockfile contract: report-only continuous optimization should not install dependencies', () => {
  const workflow = readWorkflow('ci.yml');
  const job = readWorkflowJob(workflow, 'continuous-optimization-inventory');

  assert.doesNotMatch(job, /uses:\s*pnpm\/action-setup@v4/);
  assert.doesNotMatch(job, /pnpm install/);
  assert.doesNotMatch(job, /cache:\s*"pnpm"/);
  assert.match(job, /node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}/);
  assert.match(job, /run: node scripts\/run-continuous-optimization\.js --report-only/);
});

test('workflow lockfile contract: ci workflow should not run extension jobs for docs-only changes', () => {
  const workflow = readWorkflow('ci.yml');

  assert.match(workflow, /paths:/);
  assert.match(workflow, /"bilibili-vocab-extension\/\*\*"/);
  assert.match(workflow, /"\.github\/workflows\/\*\*"/);
  assert.doesNotMatch(workflow, /"docs\/\*\*"/);
});

test('workflow lockfile contract: ci workflow should only matrix runtime tests across node versions', () => {
  const workflow = readWorkflow('ci.yml');
  const lintJob = readWorkflowJob(workflow, 'lint');
  const testJob = readWorkflowJob(workflow, 'test');

  assert.doesNotMatch(lintJob, /matrix:/);
  assert.match(lintJob, /node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}/);
  assert.match(testJob, /matrix:[\s\S]*node-version:\s*\["20",\s*"22"\]/);
  assert.match(testJob, /node-version:\s*\$\{\{\s*matrix\.node-version\s*\}\}/);
});

test('workflow lockfile contract: artifact names should be unique per workflow', () => {
  for (const fileName of ['ci.yml', 'overlay-baseline-refresh.yml']) {
    const names = collectUploadArtifactNames(readWorkflow(fileName));
    const uniqueNames = new Set(names);

    assert.notEqual(names.length, 0, `Missing upload-artifact steps in ${fileName}`);
    assert.deepEqual(
      names,
      [...uniqueNames],
      `Duplicate upload-artifact names in ${fileName}: ${names.join(', ')}`
    );
  }
});

test('workflow lockfile contract: workflows should use only reviewed action majors', () => {
  const allowedUses = new Set([
    'actions/checkout@v4',
    'actions/setup-node@v4',
    'actions/upload-artifact@v4',
    'pnpm/action-setup@v4',
  ]);

  for (const fileName of ['ci.yml', 'overlay-baseline-refresh.yml']) {
    const uses = collectWorkflowUses(readWorkflow(fileName));

    assert.notEqual(uses.length, 0, `Missing action uses in ${fileName}`);
    assert.deepEqual(
      uses.filter((actionRef) => !allowedUses.has(actionRef)),
      [],
      `Unexpected action reference in ${fileName}: ${uses.join(', ')}`
    );
  }
});

test('workflow lockfile contract: workflows should pin token permissions to read-only contents', () => {
  for (const fileName of ['ci.yml', 'overlay-baseline-refresh.yml']) {
    const permissions = readTopLevelBlock(readWorkflow(fileName), 'permissions');

    assert.equal(permissions.trim(), 'contents: read');
  }
});

test('workflow lockfile contract: checkout should not persist git credentials', () => {
  for (const fileName of ['ci.yml', 'overlay-baseline-refresh.yml']) {
    const checkoutBlocks = collectCheckoutBlocks(readWorkflow(fileName));

    assert.notEqual(checkoutBlocks.length, 0, `Missing checkout steps in ${fileName}`);
    for (const block of checkoutBlocks) {
      assert.match(block, /persist-credentials:\s*false/);
    }
  }
});

test('workflow lockfile contract: baseline refresh workflow should freeze pnpm lockfile install', () => {
  const workflow = readWorkflow('overlay-baseline-refresh.yml');
  const installCommands = collectPnpmInstallCommands(workflow);

  assert.equal(installCommands.length, 1);
  assert.doesNotMatch(workflow, /--no-frozen-lockfile/);
  assert.doesNotMatch(
    workflow,
    /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/package\.json/
  );
  assert.match(workflow, /cache-dependency-path:\s*\$\{\{\s*env\.WORKDIR\s*\}\}\/pnpm-lock\.yaml/);
  assert.match(installCommands[0], /--frozen-lockfile/);
});

test('workflow lockfile contract: baseline refresh workflow should build before refreshing and export patch', () => {
  const workflow = readWorkflow('overlay-baseline-refresh.yml');

  assert.match(workflow, /^on:\s*\r?\n\s+workflow_dispatch:\s*$/m);
  assert.match(
    workflow,
    /name: Build extension and generate overlay report[\s\S]*run: pnpm run build:extension[\s\S]*name: Refresh overlay baseline[\s\S]*run: pnpm run refresh:overlay-baseline/
  );
  assert.match(
    workflow,
    /git diff -- "\$\{WORKDIR\}\/config\/overlay-size-baseline\.json" > overlay-size-baseline\.patch/
  );
  assert.match(workflow, /id: baseline_patch/);
  assert.match(workflow, /if: steps\.baseline_patch\.outputs\.changed == 'true'/);
  assert.match(workflow, /name: overlay-size-baseline/);
  assert.match(workflow, /bilibili-vocab-extension\/config\/overlay-size-baseline\.json/);
  assert.match(workflow, /overlay-size-baseline\.patch/);
  assert.match(workflow, /if-no-files-found:\s*error/);
});
