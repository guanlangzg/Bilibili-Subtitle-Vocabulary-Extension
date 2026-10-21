const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('overlay settings hook: commit should queue merges from latest working draft', () => {
  const source = readProjectFile('react-ui/src/hooks/use-overlay-settings.ts');

  assert.match(source, /workingRef/);
  assert.match(source, /commitQueueRef|enqueueCommit|commitGeneration/);
  assert.match(source, /setError\(/);
  assert.match(source, /保存失败/);
});

test('overlay entry: commitSettings should patch from latest draft not render snapshot only', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');

  assert.match(source, /mutateWorking|commitFromUpdater|commitSettings/);
  assert.doesNotMatch(
    source,
    /async function commitSettings\(updater: \(draft: SettingsV3\) => SettingsV3, message: string\) \{\s*const next = normalizeSettingsV3\(updater\(cloneSettings\(currentSettings\)\)\);/
  );
  assert.match(source, /debounce|commitProfilePatch|scheduleProfileCommit|PROFILE_COMMIT_DEBOUNCE/);
});

test('overlay entry: review speed field should stay visible under controls tab', () => {
  const source = readProjectFile('react-ui/src/components/overlay-entry.tsx');
  assert.match(source, /id="bsvSpeed"/);
  assert.match(source, /getReviewDanmakuSpeedLabel/);
  const speedIndex = source.indexOf('id="bsvSpeed"');
  const nearby = source.slice(Math.max(0, speedIndex - 120), speedIndex + 80);
  assert.doesNotMatch(nearby, /bsv-tab-section--display/);
});
