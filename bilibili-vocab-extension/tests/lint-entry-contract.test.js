const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');

function readPackageScripts() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
}

async function calculateLintRules(filePath) {
  const eslint = new ESLint({
    cwd: path.join(__dirname, '..'),
  });
  const config = await eslint.calculateConfigForFile(filePath);
  return config && config.rules ? config.rules : {};
}

function normalizeScript(script) {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLintExtensions(lintScript) {
  const match = lintScript.match(/--ext\s+([^\s]+)/);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

test('lint entry contract: should run eslint on explicit source roots', () => {
  const scripts = readPackageScripts();
  const lintScript = normalizeScript(scripts.lint);

  assert.notEqual(lintScript, '');
  assert.match(lintScript, /^eslint\s+/);
  assert.match(lintScript, /"\*\.js"/);
  assert.match(lintScript, /"\*\.cjs"/);
  assert.match(lintScript, /"scripts"/);
  assert.match(lintScript, /"tests"/);
  assert.match(lintScript, /"contentScript"/);
  assert.match(lintScript, /"react-ui\/src"/);
  assert.match(lintScript, /--max-warnings\s+0/);
});

test('lint entry contract: should lint both javascript and typescript files', () => {
  const scripts = readPackageScripts();
  const lintScript = normalizeScript(scripts.lint);
  const extensions = parseLintExtensions(lintScript);

  const expectedExtensions = ['js', 'cjs', 'mjs', 'ts', 'tsx'];
  expectedExtensions.forEach((ext) => {
    assert.equal(extensions.includes(ext), true);
  });
});

test('lint entry contract: javascript runtime and node tests should receive flat config rules', async () => {
  const expectedFiles = [
    'adaptiveTuning.js',
    'scripts/build-vocab-dataset.js',
    'tests/adaptive-tuning.test.js',
  ];

  for (const filePath of expectedFiles) {
    const rules = await calculateLintRules(filePath);

    assert.notEqual(
      Object.keys(rules).length,
      0,
      `${filePath} should not use an empty lint config`
    );
    assert.equal(Object.prototype.hasOwnProperty.call(rules, 'no-unreachable'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(rules, 'prettier/prettier'), true);
  }
});
