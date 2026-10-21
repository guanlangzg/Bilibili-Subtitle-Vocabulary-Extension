const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { parseBudget, toKb, toRoundedKb } = require('./lib/size-budget-utils.js');

const DEFAULT_OVERLAY_FILE = path.resolve(__dirname, '..', 'dist', 'overlay.js');
const DEFAULT_OVERLAY_REPORT_FILE = path.resolve(
  __dirname,
  '..',
  'dist',
  'overlay-size-report.json'
);
const DEFAULT_OVERLAY_BASELINE_FILE = path.resolve(
  __dirname,
  '..',
  'config',
  'overlay-size-baseline.json'
);
const DEFAULT_RAW_BUDGET_KB = 280;
const DEFAULT_GZIP_BUDGET_KB = 70;
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..');

function assertPositiveBudget(rawBudgetKb, gzipBudgetKb) {
  if (!Number.isFinite(rawBudgetKb) || rawBudgetKb <= 0) {
    throw new Error(
      'Invalid raw size budget. Use OVERLAY_SIZE_BUDGET_RAW_KB with a positive number.'
    );
  }
  if (!Number.isFinite(gzipBudgetKb) || gzipBudgetKb <= 0) {
    throw new Error(
      'Invalid gzip size budget. Use OVERLAY_SIZE_BUDGET_GZIP_KB with a positive number.'
    );
  }
}

function evaluateBudgets(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb) {
  const rawPass = rawKb <= rawBudgetKb;
  const gzipPass = gzipKb <= gzipBudgetKb;
  return {
    raw: rawPass ? 'pass' : 'fail',
    gzip: gzipPass ? 'pass' : 'fail',
    overall: rawPass && gzipPass ? 'pass' : 'fail',
  };
}

function normalizeBaseline(rawBaseline) {
  if (!rawBaseline || typeof rawBaseline !== 'object') {
    return null;
  }

  const raw = Number(rawBaseline.raw);
  const gzip = Number(rawBaseline.gzip);
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(gzip) || gzip <= 0) {
    return null;
  }

  return {
    raw: toRoundedKb(raw),
    gzip: toRoundedKb(gzip),
  };
}

function readBaseline(baselineFile) {
  if (!baselineFile || !fs.existsSync(baselineFile)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    const baseline = normalizeBaseline(parsed);
    if (!baseline) {
      console.warn(`[overlay-size-check] Ignored invalid baseline payload in ${baselineFile}`);
      return null;
    }
    return baseline;
  } catch (error) {
    console.warn(
      `[overlay-size-check] Failed to read baseline file: ${error && error.message ? error.message : error}`
    );
    return null;
  }
}

function normalizeCheckedFilePath(overlayFile, projectRoot = DEFAULT_PROJECT_ROOT) {
  const normalizedOverlayFile = path.resolve(overlayFile);
  const normalizedProjectRoot = path.resolve(projectRoot);
  const relativePath = path.relative(normalizedProjectRoot, normalizedOverlayFile);

  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath.replace(/\\/g, '/');
  }

  return normalizedOverlayFile.replace(/\\/g, '/');
}

function createReport(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb, baselineKb, checkedFile) {
  const report = {
    checkedAt: new Date().toISOString(),
    file: checkedFile || 'dist/overlay.js',
    budgetKb: {
      raw: rawBudgetKb,
      gzip: gzipBudgetKb,
    },
    actualKb: {
      raw: rawKb,
      gzip: gzipKb,
    },
    result: evaluateBudgets(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb),
  };

  if (baselineKb) {
    report.baselineKb = {
      raw: baselineKb.raw,
      gzip: baselineKb.gzip,
    };
    report.deltaKb = {
      raw: toRoundedKb(rawKb - baselineKb.raw),
      gzip: toRoundedKb(gzipKb - baselineKb.gzip),
    };
  }

  return report;
}

function writeGithubSummary(summaryPath, report) {
  if (!summaryPath) {
    return;
  }

  const rawPass = report.result.raw === 'pass';
  const gzipPass = report.result.gzip === 'pass';
  const hasBaseline = Boolean(report.baselineKb && report.deltaKb);
  const lines = ['### Overlay Size Gate', ''];

  if (hasBaseline) {
    lines.push('| Metric | Actual | Budget | Baseline | Delta | Result |');
    lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
    lines.push(
      `| Raw | ${report.actualKb.raw} KB | ${report.budgetKb.raw} KB | ${report.baselineKb.raw} KB | ${report.deltaKb.raw} KB | ${rawPass ? 'OK' : 'Exceeded'} |`
    );
    lines.push(
      `| Gzip | ${report.actualKb.gzip} KB | ${report.budgetKb.gzip} KB | ${report.baselineKb.gzip} KB | ${report.deltaKb.gzip} KB | ${gzipPass ? 'OK' : 'Exceeded'} |`
    );
  } else {
    lines.push('| Metric | Actual | Budget | Result |');
    lines.push('| --- | ---: | ---: | --- |');
    lines.push(
      `| Raw | ${report.actualKb.raw} KB | ${report.budgetKb.raw} KB | ${rawPass ? 'OK' : 'Exceeded'} |`
    );
    lines.push(
      `| Gzip | ${report.actualKb.gzip} KB | ${report.budgetKb.gzip} KB | ${gzipPass ? 'OK' : 'Exceeded'} |`
    );
  }

  lines.push('');
  lines.push(`Overall: ${report.result.overall === 'pass' ? 'PASS' : 'FAIL'}`);
  lines.push('');

  try {
    fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn(
      `[overlay-size-check] Failed to write GitHub summary: ${error && error.message ? error.message : error}`
    );
  }
}

function writeOverlaySizeReport(reportPath, report) {
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(
      `[overlay-size-check] Failed to write report: ${error && error.message ? error.message : error}`
    );
  }
}

function runOverlaySizeCheck(options = {}) {
  const overlayFile = path.resolve(
    options.overlayFile || process.env.OVERLAY_SIZE_FILE || DEFAULT_OVERLAY_FILE
  );
  const reportFile = path.resolve(
    options.reportFile || process.env.OVERLAY_SIZE_REPORT_FILE || DEFAULT_OVERLAY_REPORT_FILE
  );
  const baselineFile = path.resolve(
    options.baselineFile || process.env.OVERLAY_SIZE_BASELINE_FILE || DEFAULT_OVERLAY_BASELINE_FILE
  );
  const summaryPath = options.summaryPath || process.env.GITHUB_STEP_SUMMARY || '';
  const rawBudgetKb = parseBudget(
    options.rawBudgetKb,
    parseBudget(process.env.OVERLAY_SIZE_BUDGET_RAW_KB, DEFAULT_RAW_BUDGET_KB)
  );
  const gzipBudgetKb = parseBudget(
    options.gzipBudgetKb,
    parseBudget(process.env.OVERLAY_SIZE_BUDGET_GZIP_KB, DEFAULT_GZIP_BUDGET_KB)
  );

  assertPositiveBudget(rawBudgetKb, gzipBudgetKb);

  if (!fs.existsSync(overlayFile)) {
    throw new Error(`Missing ${overlayFile}. Run 'pnpm run build:extension' before this check.`);
  }

  const rawBuffer = fs.readFileSync(overlayFile);
  const gzipBuffer = zlib.gzipSync(rawBuffer);
  const rawKb = toKb(rawBuffer.byteLength);
  const gzipKb = toKb(gzipBuffer.byteLength);
  const baselineKb = readBaseline(baselineFile);
  const checkedFile = normalizeCheckedFilePath(
    overlayFile,
    options.projectRoot || DEFAULT_PROJECT_ROOT
  );
  const report = createReport(rawKb, gzipKb, rawBudgetKb, gzipBudgetKb, baselineKb, checkedFile);

  writeGithubSummary(summaryPath, report);
  writeOverlaySizeReport(reportFile, report);

  return {
    overlayFile,
    reportFile,
    baselineFile,
    report,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    return {};
  }

  throw new Error(`Unknown overlay size option: ${argv[0]}`);
}

function runCli() {
  try {
    parseCliArgs();
    const { report } = runOverlaySizeCheck();
    console.log(
      `[overlay-size-check] overlay.js raw=${report.actualKb.raw}KB (budget ${report.budgetKb.raw}KB), gzip=${report.actualKb.gzip}KB (budget ${report.budgetKb.gzip}KB)`
    );

    if (report.result.overall !== 'pass') {
      console.error('[overlay-size-check] Overlay bundle exceeds budget.');
      process.exit(1);
    }

    console.log('[overlay-size-check] Passed.');
  } catch (error) {
    console.error(`[overlay-size-check] ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_OVERLAY_FILE,
  DEFAULT_OVERLAY_REPORT_FILE,
  DEFAULT_OVERLAY_BASELINE_FILE,
  DEFAULT_RAW_BUDGET_KB,
  DEFAULT_GZIP_BUDGET_KB,
  DEFAULT_PROJECT_ROOT,
  parseBudget,
  toKb,
  toRoundedKb,
  normalizeBaseline,
  normalizeCheckedFilePath,
  readBaseline,
  evaluateBudgets,
  createReport,
  parseCliArgs,
  runOverlaySizeCheck,
};
