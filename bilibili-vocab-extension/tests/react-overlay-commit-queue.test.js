const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadCommitQueueModule() {
  const sourcePath = path.join(__dirname, '..', 'react-ui', 'src', 'lib', 'commit-queue.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require,
    console,
  });
  return module.exports;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('commit queue runs enqueued commits serially in enqueue order', async () => {
  const { createCommitQueue } = loadCommitQueueModule();
  const queue = createCommitQueue();
  const events = [];

  const first = createDeferred();
  const second = createDeferred();

  const firstDone = queue.enqueue(async () => {
    events.push('first:start');
    await first.promise;
    events.push('first:end');
    return 'first';
  });
  const secondDone = queue.enqueue(async () => {
    events.push('second:start');
    await second.promise;
    events.push('second:end');
    return 'second';
  });

  // Runs start on a microtask after enqueue; flush before asserting order.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  first.resolve();
  assert.equal(await firstDone, 'first');
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
  second.resolve();
  assert.equal(await secondDone, 'second');
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('commit queue marks earlier commits as superseded once a newer one is enqueued', async () => {
  const { createCommitQueue } = loadCommitQueueModule();
  const queue = createCommitQueue();
  const gate = createDeferred();

  const observations = {};
  const firstDone = queue.enqueue(async (context) => {
    await gate.promise;
    observations.first = {
      generation: context.generation,
      superseded: context.isSuperseded(),
    };
    return 'first';
  });
  const secondContext = {};
  const secondDone = queue.enqueue(async (context) => {
    observations.second = {
      generation: context.generation,
      superseded: context.isSuperseded(),
      firstStillCurrent: queue.isCurrent(context.generation - 1),
    };
    return 'second';
  });

  gate.resolve();
  await Promise.all([firstDone, secondDone]);

  assert.equal(observations.first.superseded, true);
  assert.equal(observations.second.superseded, false);
  assert.equal(observations.second.firstStillCurrent, false);
  assert.equal(queue.isCurrent(observations.second.generation), true);
});

test('commit queue keeps resolving later commits after one throws', async () => {
  const { createCommitQueue } = loadCommitQueueModule();
  const queue = createCommitQueue();

  await assert.rejects(
    queue.enqueue(async () => {
      throw new Error('persist failed');
    }),
    /persist failed/
  );

  const result = await queue.enqueue(async (context) => ({
    generation: context.generation,
    current: queue.isCurrent(context.generation),
  }));
  assert.equal(result.current, true);
});

test('commit queue generation starts at zero and isCurrent reflects the newest commit', async () => {
  const { createCommitQueue } = loadCommitQueueModule();
  const queue = createCommitQueue();

  assert.equal(queue.isCurrent(0), true);
  const generation = await queue.enqueue(async (context) => context.generation);
  assert.equal(generation, 1);
  assert.equal(queue.isCurrent(1), true);
  assert.equal(queue.isCurrent(2), false);
});
