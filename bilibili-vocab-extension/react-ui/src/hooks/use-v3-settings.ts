import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsV3, cloneSettingsV3, normalizeSettingsV3 } from '../lib/settings-bridge';
import { loadSettingsV3, saveSettingsV3, subscribeSettingsChanges } from '../lib/settings-client';

interface UseV3SettingsOptions {
  initialStatus?: string;
  subscribeExternal?: boolean;
  onLoaded?: (settings: SettingsV3) => void;
}

export interface SettingsUiFeedback {
  stage: 'info' | 'saving' | 'success' | 'error' | 'conflict';
  code: string;
  message: string;
  suggestion?: string;
}

export interface V3SettingsConflict {
  source: 'external-storage';
  detectedAt: number;
  remote: SettingsV3;
  scopes: string[];
  summary: string;
}

export interface SettingsSaveResult {
  settings: SettingsV3;
  preservedLocalEdits: boolean;
}

export interface PersistedSettingsReconciliation {
  saved: SettingsV3;
  working: SettingsV3;
  preservedLocalEdits: boolean;
}

interface UseV3SettingsResult {
  saved: SettingsV3 | null;
  working: SettingsV3 | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  conflict: V3SettingsConflict | null;
  status: string;
  statusCode: string;
  feedback: SettingsUiFeedback | null;
  setStatus: (message: string) => void;
  setWorkingDirect: (next: SettingsV3) => void;
  mutateWorking: (updater: (draft: SettingsV3) => SettingsV3) => void;
  commit: (next: SettingsV3, message?: string) => Promise<SettingsSaveResult | null>;
  save: (message?: string) => Promise<SettingsSaveResult | null>;
  reset: (message?: string) => void;
  reload: () => void;
  resolveConflictUseRemote: (message?: string) => void;
  resolveConflictUseLocal: (message?: string) => Promise<SettingsSaveResult | null>;
}

function areSettingsEqual(left: SettingsV3 | null, right: SettingsV3 | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function reconcilePersistedSettings(
  persisted: SettingsV3,
  requestedSnapshot: SettingsV3,
  latestWorking: SettingsV3 | null
): PersistedSettingsReconciliation {
  const normalizedPersisted = normalizeSettingsV3(persisted);
  const normalizedRequested = normalizeSettingsV3(requestedSnapshot);
  const normalizedLatest = latestWorking ? normalizeSettingsV3(latestWorking) : null;
  const preservedLocalEdits = Boolean(
    normalizedLatest && !areSettingsEqual(normalizedLatest, normalizedRequested)
  );

  return {
    saved: normalizedPersisted,
    working: preservedLocalEdits && normalizedLatest ? normalizedLatest : normalizedPersisted,
    preservedLocalEdits,
  };
}

export function useV3Settings(options: UseV3SettingsOptions = {}): UseV3SettingsResult {
  const { initialStatus = '正在读取配置...', subscribeExternal = true, onLoaded } = options;

  const [saved, setSaved] = useState<SettingsV3 | null>(null);
  const [working, setWorking] = useState<SettingsV3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [statusCode, setStatusCode] = useState('');
  const [feedback, setFeedback] = useState<SettingsUiFeedback | null>(null);
  const [conflict, setConflict] = useState<V3SettingsConflict | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const dirtyRef = useRef(false);
  const workingRef = useRef<SettingsV3 | null>(null);

  const dirty = useMemo(() => {
    if (!saved || !working) {
      return false;
    }
    return JSON.stringify(saved) !== JSON.stringify(working);
  }, [saved, working]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  function mapErrorCode(error: unknown, fallback = 'E_SETTINGS_UNKNOWN'): string {
    const text = String(
      (error as { message?: string } | null)?.message || error || ''
    ).toLowerCase();
    if (text.includes('quota')) {
      return 'E_STORAGE_QUOTA';
    }
    if (text.includes('storage') && text.includes('unavailable')) {
      return 'E_STORAGE_UNAVAILABLE';
    }
    if (text.includes('timeout')) {
      return 'E_STORAGE_TIMEOUT';
    }
    return fallback;
  }

  function setFeedbackState(next: SettingsUiFeedback) {
    setFeedback(next);
    setStatus(next.message);
    setStatusCode(next.code);
  }

  // Stable identity: data hooks include setStatus in their effect deps, so a
  // per-render function here would restart their read loops on every render.
  const setStatusText = useCallback((message: string) => {
    setStatus(message);
    setStatusCode('');
    setFeedback(null);
  }, []);

  function setWorkingState(next: SettingsV3 | null) {
    workingRef.current = next;
    setWorking(next);
  }

  function detectConflictScopes(local: SettingsV3 | null, remote: SettingsV3): string[] {
    if (!local) {
      return ['配置中心'];
    }

    const scopes: string[] = [];
    if (
      local.activeProfileId !== remote.activeProfileId ||
      JSON.stringify(local.profilesBuiltin) !== JSON.stringify(remote.profilesBuiltin) ||
      JSON.stringify(local.profilesCustom) !== JSON.stringify(remote.profilesCustom)
    ) {
      scopes.push('配置档与学习参数');
    }

    if (
      local.globalControls.reviewDanmakuEnabled !== remote.globalControls.reviewDanmakuEnabled ||
      local.globalControls.webPageEnabled !== remote.globalControls.webPageEnabled
    ) {
      scopes.push('全局开关');
    }

    if (
      JSON.stringify(local.globalControls.siteRules) !==
      JSON.stringify(remote.globalControls.siteRules)
    ) {
      scopes.push('站点规则');
    }

    if (
      JSON.stringify(local.globalControls.overlayState) !==
      JSON.stringify(remote.globalControls.overlayState)
    ) {
      scopes.push('悬浮面板');
    }

    return scopes.length ? scopes : ['未知范围'];
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatusText(initialStatus);
    void (async () => {
      try {
        const payload = await loadSettingsV3();
        if (cancelled) {
          return;
        }
        setSaved(payload);
        setWorkingState(payload);
        setLoading(false);
        setConflict(null);
        setFeedbackState({
          stage: 'success',
          code: 'S_INIT_SYNCED',
          message: '配置已同步，可编辑后手动保存。',
          suggestion: '修改后点击保存即可在三端生效。',
        });
        if (onLoaded) {
          onLoaded(payload);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setFeedbackState({
          stage: 'error',
          code: mapErrorCode(error, 'E_INIT_LOAD_FAILED'),
          message: '读取配置失败，请刷新后重试。',
          suggestion: '如问题持续，可先在选项页执行重置再保存。',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLoaded, initialStatus, reloadNonce]);

  useEffect(() => {
    if (!subscribeExternal) {
      return () => {};
    }
    return subscribeSettingsChanges((next) => {
      setSaved(next);
      if (!dirtyRef.current) {
        setWorkingState(next);
        setConflict(null);
        setFeedbackState({
          stage: 'success',
          code: 'S_EXTERNAL_SYNCED',
          message: '已同步外部更新。',
          suggestion: '当前配置已与外部保持一致。',
        });
      } else {
        const scopes = detectConflictScopes(workingRef.current, next);
        setConflict({
          source: 'external-storage',
          detectedAt: Date.now(),
          remote: cloneSettingsV3(next),
          scopes,
          summary: scopes.join('、'),
        });
        setFeedbackState({
          stage: 'conflict',
          code: 'W_EXTERNAL_CONFLICT',
          message: '检测到外部更新：可应用远端版本，或保存本地版本覆盖。',
          suggestion: '建议先查看冲突范围，再决定保留本地或远端。',
        });
      }
    });
  }, [subscribeExternal]);

  const setWorkingDirect = useCallback((next: SettingsV3) => {
    setWorkingState(normalizeSettingsV3(next));
  }, []);

  const mutateWorking = useCallback((updater: (draft: SettingsV3) => SettingsV3) => {
    setWorking((previous) => {
      if (!previous) {
        return previous;
      }
      const draft = cloneSettingsV3(previous);
      const next = normalizeSettingsV3(updater(draft));
      workingRef.current = next;
      return next;
    });
  }, []);

  const persistSettings = useCallback(async (snapshot: SettingsV3, message: string) => {
    const requestedSnapshot = cloneSettingsV3(snapshot);
    if (!requestedSnapshot) {
      return null;
    }
    setSaving(true);
    setFeedbackState({
      stage: 'saving',
      code: 'P_SAVE_START',
      message: '正在保存...',
      suggestion: '请稍候，保存完成后将自动同步到三端。',
    });
    try {
      const persisted = await saveSettingsV3(requestedSnapshot);
      const reconciliation = reconcilePersistedSettings(
        persisted,
        requestedSnapshot,
        workingRef.current
      );
      setSaved(reconciliation.saved);
      setWorkingState(reconciliation.working);
      setConflict(null);
      setSaving(false);
      setFeedbackState({
        stage: 'success',
        code: reconciliation.preservedLocalEdits ? 'S_SAVE_PENDING_LOCAL_EDITS' : 'S_SAVE_OK',
        message: reconciliation.preservedLocalEdits
          ? '最近一次保存已完成，保存后的继续编辑已保留。'
          : message,
        suggestion: reconciliation.preservedLocalEdits
          ? '当前仍有未保存修改，可继续编辑后再次保存。'
          : '你可以继续编辑，或切换到其他端验证同步结果。',
      });
      return {
        settings: reconciliation.saved,
        preservedLocalEdits: reconciliation.preservedLocalEdits,
      };
    } catch (error) {
      setSaving(false);
      setFeedbackState({
        stage: 'error',
        code: mapErrorCode(error, 'E_SAVE_FAILED'),
        message: '保存失败，请重试。',
        suggestion: '可先应用远端版本确认差异，或重试保存本地版本。',
      });
      return null;
    }
  }, []);

  const commit = useCallback(
    async (next: SettingsV3, message = '更改已保存。') => {
      const snapshot = normalizeSettingsV3(next);
      setWorkingState(snapshot);
      return persistSettings(snapshot, message);
    },
    [persistSettings]
  );

  const save = useCallback(
    async (message = '配置已保存并应用到扩展。') => {
      const requestedSnapshot = workingRef.current ? cloneSettingsV3(workingRef.current) : null;
      if (!requestedSnapshot) {
        return null;
      }
      return persistSettings(requestedSnapshot, message);
    },
    [persistSettings]
  );

  const reset = useCallback(
    (message = '已撤销未保存修改。') => {
      if (!saved) {
        return;
      }
      setWorkingState(cloneSettingsV3(saved));
      setConflict(null);
      setFeedbackState({
        stage: 'success',
        code: 'S_RESET_TO_SAVED',
        message,
        suggestion: '当前工作副本已回到最近一次稳定状态。',
      });
    },
    [saved]
  );

  const resolveConflictUseRemote = useCallback(
    (message = '已应用远端版本，当前与最新配置同步。') => {
      if (!conflict) {
        return;
      }
      const remote = cloneSettingsV3(conflict.remote);
      setSaved(remote);
      setWorkingState(remote);
      setConflict(null);
      setFeedbackState({
        stage: 'success',
        code: 'S_CONFLICT_USE_REMOTE',
        message,
        suggestion: '如仍需本地变更，可在此版本基础上重新编辑并保存。',
      });
    },
    [conflict]
  );

  const resolveConflictUseLocal = useCallback(
    async (message = '已应用本地版本，并覆盖外部修改。') => {
      const requestedSnapshot = workingRef.current ? cloneSettingsV3(workingRef.current) : null;
      if (!requestedSnapshot) {
        return null;
      }
      setSaving(true);
      setFeedbackState({
        stage: 'saving',
        code: 'P_CONFLICT_SAVE_LOCAL_START',
        message: '正在应用本地版本...',
        suggestion: '完成后将覆盖远端并清除冲突状态。',
      });
      try {
        const persisted = await saveSettingsV3(requestedSnapshot);
        const reconciliation = reconcilePersistedSettings(
          persisted,
          requestedSnapshot,
          workingRef.current
        );
        setSaved(reconciliation.saved);
        setWorkingState(reconciliation.working);
        setConflict(null);
        setSaving(false);
        setFeedbackState({
          stage: 'success',
          code: reconciliation.preservedLocalEdits
            ? 'S_CONFLICT_USE_LOCAL_PENDING_EDITS'
            : 'S_CONFLICT_USE_LOCAL',
          message: reconciliation.preservedLocalEdits
            ? '本地版本已覆盖远端，保存后的继续编辑已保留。'
            : message,
          suggestion: reconciliation.preservedLocalEdits
            ? '当前仍有未保存修改，可继续编辑后再次保存。'
            : '建议在其他端刷新确认已同步到最新本地版本。',
        });
        return {
          settings: reconciliation.saved,
          preservedLocalEdits: reconciliation.preservedLocalEdits,
        };
      } catch (error) {
        setSaving(false);
        setFeedbackState({
          stage: 'error',
          code: mapErrorCode(error, 'E_CONFLICT_SAVE_LOCAL_FAILED'),
          message: '应用本地版本失败，请重试。',
          suggestion: '可先应用远端版本，确认后再重新编辑保存。',
        });
        return null;
      }
    },
    []
  );

  return {
    saved,
    working,
    loading,
    saving,
    dirty,
    conflict,
    status,
    statusCode,
    feedback,
    setStatus: setStatusText,
    setWorkingDirect,
    mutateWorking,
    commit,
    save,
    reset,
    reload: () => setReloadNonce((previous) => previous + 1),
    resolveConflictUseRemote,
    resolveConflictUseLocal,
  };
}
