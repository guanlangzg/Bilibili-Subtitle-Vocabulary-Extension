/**
 * Serial commit queue with generation-based superseding, shared by settings
 * hooks. Each enqueued commit runs after the previous one settles; a commit
 * can detect that a newer one has been enqueued and skip its UI updates
 * while still persisting its own snapshot.
 */
export interface CommitTaskContext {
  /** 1-based generation of this commit; every enqueue increments it. */
  generation: number;
  /** True when a newer commit has been enqueued after this one started. */
  isSuperseded(): boolean;
}

export interface CommitQueue {
  /**
   * Queue one commit and return its eventual result. `run` may return null.
   * The returned promise resolves with whatever `run` returns and rejects
   * only if `run` throws; the internal chain swallows that rejection so a
   * failed commit never blocks the next one.
   */
  enqueue<T>(run: (context: CommitTaskContext) => Promise<T>): Promise<T>;
  /** True when `generation` is still the newest enqueued commit. */
  isCurrent(generation: number): boolean;
}

export function createCommitQueue(): CommitQueue {
  let tail: Promise<unknown> = Promise.resolve(null);
  let generation = 0;

  return {
    enqueue<T>(run: (context: CommitTaskContext) => Promise<T>): Promise<T> {
      const current = ++generation;
      const start = (): Promise<T> =>
        run({
          generation: current,
          isSuperseded: () => current !== generation,
        });
      const queued = tail.then(start, start);
      tail = queued.then(
        () => null,
        () => null
      );
      return queued;
    },
    isCurrent: (generationToCheck: number): boolean => generationToCheck === generation,
  };
}
