const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('settings hooks expose atomic commit for immediate interaction saves', () => {
  const v3Hook = readProjectFile('react-ui/src/hooks/use-v3-settings.ts');
  const overlayHook = readProjectFile('react-ui/src/hooks/use-overlay-settings.ts');

  assert.match(v3Hook, /commit:\s*\(next:\s*SettingsV3,\s*message\?:\s*string\)/);
  assert.match(v3Hook, /const commit = useCallback/);
  assert.match(v3Hook, /setWorkingState\(snapshot\)/);
  assert.match(v3Hook, /persistSettings\(snapshot, message\)/);

  assert.match(overlayHook, /commit:\s*\(settings:\s*SettingsV3,\s*message\?:\s*string\)/);
  assert.match(overlayHook, /const commit = useCallback/);
  assert.match(overlayHook, /normalizeSettingsV3\(settings\)/);
  assert.match(overlayHook, /saveOverlaySettingsV3\(snapshot\)/);
});
