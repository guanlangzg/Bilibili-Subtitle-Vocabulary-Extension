'use strict';

// Shared pnpm/spawn helpers for the release gate scripts
// (run-continuous-optimization.js and run-release-candidate-checks.js).

function getPnpmCommand(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function quoteCommandPart(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function formatCommand(command, args = []) {
  return [command, ...args].map(quoteCommandPart).join(' ');
}

function shouldSpawnWithShell(command, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command || ''));
}

function createSpawnSpec(command, args = [], options = {}) {
  const useShell = shouldSpawnWithShell(command, options.platform);
  return {
    command: useShell ? formatCommand(command, args) : command,
    args: useShell ? [] : args,
    shell: useShell,
  };
}

module.exports = {
  createSpawnSpec,
  formatCommand,
  getPnpmCommand,
  quoteCommandPart,
  shouldSpawnWithShell,
};
