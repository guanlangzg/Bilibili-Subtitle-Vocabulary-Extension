'use strict';

// Shared KB conversion and budget parsing helpers for the release gate scripts
// (check-overlay-size.js and check-extension-package.js).

function toKb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

function toRoundedKb(value) {
  return Number(Number(value).toFixed(2));
}

function parseBudget(rawValue, fallback) {
  if (rawValue == null || rawValue === '') {
    return fallback;
  }
  return Number(rawValue);
}

module.exports = { parseBudget, toKb, toRoundedKb };
