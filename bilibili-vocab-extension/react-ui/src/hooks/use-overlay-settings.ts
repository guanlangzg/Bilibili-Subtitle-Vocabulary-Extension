import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSettingsV3 } from '../lib/overlay-settings';
import {
  loadOverlaySettingsV3,
  saveOverlaySettingsV3,
  subscribeOverlaySettingsChanges,
} from '../lib/overlay-storage';
import { createCommitQueue, type CommitQueue } from '../lib/commit-queue';
import type { SettingsV3 } from '../lib/overlay-settings';

interface UseOverlaySettingsOptions {
  initialStatus?: string;
}

interface OverlaySettingsError {
  message: string;
  suggestion?: string;
}

interface UseOverlaySettingsResult {
  working: SettingsV3 | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  status: string;
  error: OverlaySettingsError | null;
  setStatus: (message: string) => void;
  setWorkingDirect: (settings: SettingsV3) => void;
  mutateWorking: (updater: (settings: SettingsV3) => SettingsV3) => void;
  commit: (settings: SettingsV3, message?: string) => Promise<SettingsV3 | null>;
  commitFromUpdater: (
    updater: (draft: SettingsV3) => SettingsV3,
    message?: string
  ) => Promise<SettingsV3 | null>;
  save: (message?: string) => Promise<SettingsV3 | null>;
  reload: () => void;
}

function cloneSettings(settings: SettingsV3): SettingsV3 {
  return JSON.parse(JSON.stringify(settings)) as SettingsV3;
}

export function useOverlaySettings(
  options: UseOverlaySettingsOptions = {}
): UseOverlaySettingsResult {
  const { initialStatus = '正在读取配置...' } = options;

  const [saved, setSaved] = useState<SettingsV3 | null>(null);
  const [working, setWorking] = useState<SettingsV3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<OverlaySettingsError | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  const savedRef = useRef<SettingsV3 | null>(null);
  const workingRef = useRef<SettingsV3 | null>(null);
  const dirtyRef = useRef(false);
  const commitQueueRef = useRef<CommitQueue | null>(null);
  if (commitQueueRef.current === null) {
    commitQueueRef.current = createCommitQueue();
  }
  const commitQueue = commitQueueRef.current;

  const dirty = useMemo(() => {
    if (!saved || !working) {
      return false;
    }
    return JSON.stringify(saved) !== JSON.stringify(working);
  }, [saved, working]);

  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    workingRef.current = working;
  }, [working]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const settings = await loadOverlaySettingsV3();
        if (cancelled) {
          return;
        }
        setSaved(settings);
        setWorking(settings);
        workingRef.current = settings;
        setStatus('配置已同步，可在视频页直接调节。');
      } catch {
        if (cancelled) {
          return;
        }
        setError({
          message: '读取配置失败，请刷新后重试。',
          suggestion: '如问题持续，可尝试在选项页恢复默认设置。',
        });
        setStatus('读取配置失败，请刷新后重试。');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadNonce]);

  useEffect(() => {
    return subscribeOverlaySettingsChanges((next) => {
      setSaved(next);
      // Decide outside the updater: setState updaters must stay pure.
      const shouldAdoptNext = !workingRef.current || !dirtyRef.current;
      setWorking((previous) => (shouldAdoptNext ? next : previous));
      if (shouldAdoptNext) {
        workingRef.current = next;
        setStatus('已同步外部更新。');
      } else {
        setStatus('检测到外部更新，当前保留未保存编辑。');
      }
    });
  }, []);

  const reload = useCallback(() => {
    setLoadNonce((previous) => previous + 1);
  }, []);

  const setWorkingDirect = useCallback((next: SettingsV3) => {
    const normalized = normalizeSettingsV3(next);
    workingRef.current = normalized;
    setWorking(normalized);
  }, []);

  const mutateWorking = useCallback((updater: (settings: SettingsV3) => SettingsV3) => {
    setWorking((previous) => {
      if (!previous) {
        return previous;
      }
      const next = normalizeSettingsV3(updater(cloneSettings(previous)));
      workingRef.current = next;
      return next;
    });
  }, []);

  const enqueueCommit = useCallback(
    async (message = '已保存到扩展设置。') => {
      setSaving(true);
      setError(null);

      let taskGeneration = 0;
      const queued = commitQueue.enqueue(async (context) => {
        taskGeneration = context.generation;
        const snapshot = workingRef.current;
        if (!snapshot) {
          return null;
        }
        try {
          const persisted = await saveOverlaySettingsV3(snapshot);
          if (context.isSuperseded()) {
            // A newer commit superseded this one; keep the latest draft.
            return persisted;
          }
          setSaved(persisted);
          if (
            !dirtyRef.current ||
            JSON.stringify(workingRef.current) === JSON.stringify(snapshot)
          ) {
            workingRef.current = persisted;
            setWorking(persisted);
          }
          setStatus(message);
          setError(null);
          return persisted;
        } catch {
          if (!context.isSuperseded()) {
            setStatus('保存失败，请重试。');
            setError({
              message: '保存失败，请重试。',
              suggestion: '可稍后再试，或打开选项页检查扩展权限。',
            });
          }
          return null;
        }
      });

      try {
        return (await queued) as SettingsV3 | null;
      } finally {
        if (commitQueue.isCurrent(taskGeneration)) {
          setSaving(false);
        }
      }
    },
    [commitQueue]
  );

  const commit = useCallback(
    async (settings: SettingsV3, message = '已保存到扩展设置。') => {
      const snapshot = normalizeSettingsV3(settings);
      workingRef.current = snapshot;
      setWorking(snapshot);
      return enqueueCommit(message);
    },
    [enqueueCommit]
  );

  const commitFromUpdater = useCallback(
    async (updater: (draft: SettingsV3) => SettingsV3, message = '已保存到扩展设置。') => {
      const baseline = workingRef.current;
      if (!baseline) {
        return null;
      }
      const next = normalizeSettingsV3(updater(cloneSettings(baseline)));
      workingRef.current = next;
      setWorking(next);
      return enqueueCommit(message);
    },
    [enqueueCommit]
  );

  const save = useCallback(
    async (message = '已保存到扩展设置。') => {
      if (!workingRef.current) {
        return null;
      }
      return enqueueCommit(message);
    },
    [enqueueCommit]
  );

  return {
    working,
    loading,
    saving,
    dirty,
    status,
    error,
    setStatus,
    setWorkingDirect,
    mutateWorking,
    commit,
    commitFromUpdater,
    save,
    reload,
  };
}
