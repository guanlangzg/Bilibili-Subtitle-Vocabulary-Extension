const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react overlay layout contract: overlay body should remain scrollable inside fixed panel', () => {
  const stylesheet = readProjectFile('react-ui/src/styles/overlay.css');

  assert.match(
    stylesheet,
    /\.bsv-overlay-panel\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*auto 1fr;/
  );
  assert.match(stylesheet, /\.bsv-overlay-body\s*\{[\s\S]*overflow:\s*auto;/);
  assert.match(
    stylesheet,
    /\.bsv-overlay-panel\[data-collapsed="true"\]\s*\{[\s\S]*width:\s*min\(360px/
  );
  assert.match(stylesheet, /\.bsv-overlay-tabs\s*\{/);
  assert.match(stylesheet, /\.bsv-overlay-body\[data-active-tab="learn"\]/);
});

test('react overlay layout contract: overlay uses tabs and immediate commit instead of duplicate save action', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');

  assert.match(source, /type OverlayTab = 'learn' \| 'controls' \| 'display'/);
  assert.match(source, /className="bsv-overlay-tabs"/);
  assert.match(source, /data-active-tab=\{activeTab\}/);
  assert.match(source, /commitSettings\(/);
  assert.doesNotMatch(source, /SaveIcon/);
  assert.doesNotMatch(source, /保存中\.\.\.' : '保存'/);
});

test('react overlay layout contract: mountOverlayPanel should short-circuit when react root already exists', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');

  assert.match(
    source,
    /function mountOverlayPanel\(\): void \{[\s\S]*document\.getElementById\(ROOT_ID\)[\s\S]*return;/
  );
  assert.match(
    source,
    /if \(!document\.getElementById\(STYLE_ID\)\) \{[\s\S]*styleNode\.id = STYLE_ID;/
  );
});
