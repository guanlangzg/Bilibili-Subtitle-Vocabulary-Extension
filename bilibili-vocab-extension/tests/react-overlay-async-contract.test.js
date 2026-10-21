const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('react overlay async contract: overlay entry should guard summary load failure', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');

  assert.match(source, /学习概览读取失败，请稍后重试。/);
  assert.match(source, /subscribeLearningSummary/);
  assert.match(source, /最近词汇/);
  assert.match(source, /跟随学习状态实时刷新/);
});

test('react overlay async contract: overlay visibility should commit normalized snapshots', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');

  assert.match(source, /const next = normalizeSettingsV3\(\{/);
  assert.match(source, /await commit\(next, '已隐藏悬浮面板。'\)/);
  assert.match(source, /await commit\(next, '悬浮面板已恢复。'\)/);
  assert.doesNotMatch(source, /persistImmediate/);
  assert.doesNotMatch(source, /setWorkingDirect\(next\)/);
});
