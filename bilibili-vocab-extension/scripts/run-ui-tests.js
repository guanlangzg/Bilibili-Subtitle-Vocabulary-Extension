'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const testsDir = path.join(projectRoot, 'tests');

const uiTestPatterns = [
  /^background-overlay(?:-.*)?\.test\.js$/,
  /^contentScript-overlay-bridge\.test\.js$/,
  /^contentScript-overlay-loader\.test\.js$/,
  /^react-overlay-.*\.test\.js$/,
  /^react-overlay-commit-merge-contract\.test\.js$/,
  /^react-settings-.*\.test\.js$/,
  /^react-ui-.*\.test\.js$/,
  /^settings-layout\.test\.js$/,
];

function collectUiTestFiles(targetTestsDir = testsDir) {
  return fs
    .readdirSync(targetTestsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => entry.name)
    .filter((name) => uiTestPatterns.some((pattern) => pattern.test(name)))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join('tests', name));
}

function runUiTests(options = {}) {
  const targetProjectRoot = path.resolve(options.projectRoot || projectRoot);
  const targetTestsDir = options.testsDir || path.join(targetProjectRoot, 'tests');
  const runner = options.runner || spawnSync;
  const execPath = options.execPath || process.execPath;
  const stdio = options.stdio || 'inherit';
  const testFiles = options.testFiles || collectUiTestFiles(targetTestsDir);

  if (testFiles.length === 0) {
    throw new Error('No UI contract tests matched.');
  }

  const result = runner(execPath, ['--test', ...testFiles], {
    cwd: targetProjectRoot,
    stdio,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    return {};
  }

  throw new Error(`Unknown UI test option: ${argv[0]}`);
}

function runCli() {
  try {
    parseCliArgs();
    const result = runUiTests();
    process.exit(result.status ?? 1);
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  uiTestPatterns,
  collectUiTestFiles,
  parseCliArgs,
  runUiTests,
};
