import { useEffect, useState } from 'react';
import {
  SyncSettings,
  SyncStatusResult,
  readSyncSettings,
  readSyncStatus,
  runSync,
  saveSyncSettings,
} from '../lib/sync-client';
import { requestSyncOriginPermission } from '../lib/sync-permission';

const EMPTY_SETTINGS: SyncSettings = {
  enabled: false,
  serverUrl: '',
  token: '',
  clientId: '',
  lastCursor: 0,
  lastSyncedAt: null,
  lastError: null,
  lastResult: null,
};

function formatTimestamp(value: number | null): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未同步';
  return date.toLocaleString();
}

export function SyncSection() {
  const [settings, setSettings] = useState<SyncSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'sync' | 'status' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [remote, setRemote] = useState<SyncStatusResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    readSyncSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(next: Partial<SyncSettings>) {
    setSettings((current) => ({ ...current, ...next }));
  }

  async function onSave() {
    setBusy('save');
    setError('');
    setMessage('');
    try {
      // The service worker may only call origins the user granted; this must run
      // inside the click handler to keep the user gesture.
      if (settings.serverUrl.trim()) {
        const granted = await requestSyncOriginPermission(settings.serverUrl.trim());
        if (!granted) {
          setError('未授予该服务器的主机权限，保存后无法同步。');
          return;
        }
      }
      const saved = await saveSyncSettings(settings);
      setSettings(saved);
      setMessage('同步配置已保存。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存同步配置失败');
    } finally {
      setBusy(null);
    }
  }

  async function onCheckStatus() {
    setBusy('status');
    setError('');
    setMessage('');
    try {
      const result = await readSyncStatus();
      setRemote(result);
      if (!result.configured) {
        setError('请先保存服务器地址和令牌。');
        return;
      }
      setSettings(result.settings);
      setMessage(
        `服务器现有 ${result.status?.events ?? 0} 条事件、${result.status?.baselines ?? 0} 条基线，游标 ${result.status?.cursor ?? 0}。`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取服务器状态失败');
    } finally {
      setBusy(null);
    }
  }

  async function onSync() {
    setBusy('sync');
    setError('');
    setMessage('');
    try {
      if (settings.serverUrl.trim()) {
        const granted = await requestSyncOriginPermission(settings.serverUrl.trim());
        if (!granted) {
          setError('未授予该服务器的主机权限，无法同步。');
          return;
        }
      }
      const result = await runSync();
      setSettings(result.settings);
      setMessage(
        `同步完成：拉取 ${result.pulledEvents} 条事件 / ${result.pulledBaselines} 条基线，上传 ${result.acceptedEvents} 条事件 / ${result.acceptedBaselines} 条基线，重复 ${result.duplicates} 条。` +
          (result.hasMore ? '仍有远端记录待拉取，请再次同步。' : '')
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '同步失败');
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <>
      <article className="panel stack stagger-enter">
        <h2>学习记录同步</h2>
        <p className="panel-subtitle">
          插件与安卓 App 共用同一份学习事实。同步只追加事件并按 ID
          去重，不会用服务器数据覆盖本地进度。
        </p>

        {loading ? (
          <div className="summary-item">
            <strong>正在读取同步配置…</strong>
          </div>
        ) : (
          <>
            <label className="field">
              <span>服务器地址</span>
              <input
                type="text"
                value={settings.serverUrl}
                placeholder="https://sync.example.com"
                disabled={disabled}
                onChange={(event) => patch({ serverUrl: event.target.value })}
              />
            </label>
            <label className="field">
              <span>访问令牌</span>
              <input
                type="text"
                value={settings.token}
                placeholder="vsc_..."
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => patch({ token: event.target.value })}
              />
            </label>
            <label className="field">
              <span>设备标识（可选）</span>
              <input
                type="text"
                value={settings.clientId}
                placeholder="例如 desktop-chrome"
                disabled={disabled}
                onChange={(event) => patch({ clientId: event.target.value })}
              />
            </label>

            <div className="summary-list">
              <div className="summary-item">
                <strong>上次同步</strong>
                <span>{formatTimestamp(settings.lastSyncedAt)}</span>
              </div>
              <div className="summary-item">
                <strong>本地游标</strong>
                <span>{settings.lastCursor}</span>
              </div>
              {settings.lastResult && (
                <div className="summary-item">
                  <strong>上次结果</strong>
                  <span>{settings.lastResult}</span>
                </div>
              )}
              {settings.lastError && (
                <div className="summary-item">
                  <strong>上次错误</strong>
                  <span>{settings.lastError}</span>
                </div>
              )}
              {remote?.configured && remote.status && (
                <div className="summary-item">
                  <strong>服务器状态</strong>
                  <span>
                    {remote.status.events} 条事件 / {remote.status.baselines} 条基线，游标{' '}
                    {remote.status.cursor}
                  </span>
                </div>
              )}
            </div>

            <div className="btn-row">
              <button type="button" className="btn secondary" onClick={onSave} disabled={disabled}>
                {busy === 'save' ? '保存中…' : '保存同步配置'}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={onCheckStatus}
                disabled={disabled}
              >
                {busy === 'status' ? '查询中…' : '检查服务器状态'}
              </button>
              <button type="button" className="btn" onClick={onSync} disabled={disabled}>
                {busy === 'sync' ? '同步中…' : '立即同步'}
              </button>
            </div>

            {message && (
              <p className="panel-subtitle" role="status">
                {message}
              </p>
            )}
            {error && (
              <p className="panel-subtitle" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </article>
      <aside className="panel stack stagger-enter">
        <h3>同步说明</h3>
        <div className="summary-item">
          <strong>先拉取再上传</strong>
          <span>每次同步先合并服务器上的事实，再把合并结果推送回去，避免覆盖。</span>
        </div>
        <div className="summary-item">
          <strong>冲突整包拒绝</strong>
          <span>同一标识的冲突记录不会覆盖原记录；上传失败后，已导入的远端记录仍会保留。</span>
        </div>
        <div className="summary-item">
          <strong>令牌只存在本地</strong>
          <span>令牌保存在 chrome.storage.local，仅用于向该服务器发请求。</span>
        </div>
      </aside>
    </>
  );
}
