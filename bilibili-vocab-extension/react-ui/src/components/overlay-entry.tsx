import { useMemo, useState, useEffect, useRef, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
import overlayCss from '../styles/overlay.css?inline';
import uiShellCss from '../styles/ui-shell.css?inline';
import { LoadingPanel, ErrorPanel, EmptyState } from './ui-shell';
import {
  CEFR_LEVELS,
  ProfileConfig,
  REVIEW_DENSITIES,
  REVIEW_SPEEDS,
  SettingsV3,
  getProfileConfigById,
  listProfileOptions,
  normalizeSettingsV3,
  setActiveProfileConfig,
} from '../lib/overlay-settings';
import {
  readLearningSummary,
  LearningSummary,
  subscribeLearningSummary,
} from '../lib/overlay-storage';
import {
  OverlaySubtitleNavigationPayload,
  SubtitleNavigationState,
  SubtitleTimelineItem,
  buildSubtitleNavigationState,
  isSubtitleTimelineHostSupported,
  normalizeSubtitleTimeline,
  readOverlaySubtitleNavigationState,
  refreshOverlaySubtitleNavigationState,
  seekVideoToSubtitle,
  subscribeOverlaySubtitleNavigationState,
} from '../lib/subtitle-navigation';
import { getThemeModeLabel, THEME_MODE_OPTIONS, useResolvedTheme } from '../lib/bsv-theme';
import { useOverlaySettings } from '../hooks/use-overlay-settings';
import {
  BookIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CollapseIcon,
  ExpandIcon,
  HideIcon,
  ReplayIcon,
} from './icons';

const ROOT_ID = 'bsv-react-overlay-root';
const STYLE_ID = 'bsv-react-overlay-style';
const PROFILE_COMMIT_DEBOUNCE_MS = 320;
const SAVE_FAILED_PATTERN = /失败/;
type OverlayTab = 'learn' | 'controls' | 'display';

const OVERLAY_TABS: Array<{ id: OverlayTab; label: string }> = [
  { id: 'learn', label: '学习' },
  { id: 'controls', label: '控制' },
  { id: 'display', label: '显示' },
];

interface SubtitleParserApi {
  loadSubtitleTimeline?: () => Promise<unknown>;
}

function asNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampOffset(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getReviewDanmakuSpeedLabel(speed: ProfileConfig['reviewDanmakuSpeed'] | string): string {
  if (speed === 'slow') {
    return '慢速';
  }
  if (speed === 'fast') {
    return '快速';
  }
  return '标准';
}

function getReviewDensityLabel(density: ProfileConfig['reviewDanmakuDensity']): string {
  if (density === 'sparse') {
    return '低密度';
  }
  if (density === 'dense') {
    return '高密度';
  }
  return '标准';
}

const LEARNING_STATUS_LABELS: Record<string, string> = {
  unseen: '未巩固',
  new: '未巩固',
  seen: '已遇见',
  learning: '已遇见',
  reviewing: '已遇见',
  saved: '已收藏',
  mastered: '已掌握',
  skipped: '已跳过',
};

function getLearningStatusLabel(status: string | undefined): string {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  return LEARNING_STATUS_LABELS[normalized] || '';
}

function getRecentWordMeta(item: LearningSummary['recentWords'][number]): string {
  const statusLabel = getLearningStatusLabel(item.status);
  return statusLabel || '继续观看后会补齐学习状态';
}

function readVideoElement(): HTMLVideoElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const video = document.querySelector('video');
  return video && 'currentTime' in video ? (video as HTMLVideoElement) : null;
}

function readSubtitleParser(): SubtitleParserApi | null {
  const scope = globalThis as typeof globalThis & { SubtitleParser?: SubtitleParserApi };
  return scope.SubtitleParser || null;
}

function readInitialSubtitleNavigationPayload(hostname: string): OverlaySubtitleNavigationPayload {
  const payload = readOverlaySubtitleNavigationState();
  if (payload.videoKey || payload.state.loading || !isSubtitleTimelineHostSupported(hostname)) {
    return payload;
  }

  const video = readVideoElement();
  return {
    videoKey: '',
    state: buildSubtitleNavigationState({
      hostname,
      loading: Boolean(video),
      hasVideo: Boolean(video),
      currentTime: video ? Number(video.currentTime) : Number.NaN,
      timeline: [],
    }),
  };
}

function OverlayApp() {
  const hostname =
    typeof globalThis.location !== 'undefined' ? String(globalThis.location.hostname || '') : '';
  const {
    working: settings,
    loading,
    saving,
    status,
    error,
    setStatus,
    commit,
    commitFromUpdater,
    mutateWorking,
    reload,
  } = useOverlaySettings({
    initialStatus: '加载中...',
  });
  const [summary, setSummary] = useState<LearningSummary>({
    todayCount: 0,
    newCount: 0,
    masteredCount: 0,
    recentWords: [],
  });
  const [activeTab, setActiveTab] = useState<OverlayTab>('learn');
  // Lazy initializer: only read the bridge/DOM once, not on every re-render.
  const [initialSubtitlePayload] = useState(() => readInitialSubtitleNavigationPayload(hostname));
  const subtitleTimelineRef = useRef<SubtitleTimelineItem[]>([]);
  const subtitleVideoKeyRef = useRef(initialSubtitlePayload.videoKey);
  const profileCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [subtitleNavigation, setSubtitleNavigation] = useState<SubtitleNavigationState>(
    initialSubtitlePayload.state
  );

  useEffect(() => {
    return () => {
      if (profileCommitTimerRef.current) {
        clearTimeout(profileCommitTimerRef.current);
        profileCommitTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const summaryPayload = await readLearningSummary();
        if (!cancelled) {
          setSummary(summaryPayload);
        }
      } catch {
        if (!cancelled) {
          setStatus('学习概览读取失败，请稍后重试。');
        }
      }
    })();
    const unsubscribeSummary = subscribeLearningSummary((next) => {
      setSummary(next);
    });
    return () => {
      cancelled = true;
      unsubscribeSummary();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    function applyPayload(payload: OverlaySubtitleNavigationPayload) {
      if (cancelled) {
        return;
      }

      const nextPayload =
        payload && payload.state ? payload : readInitialSubtitleNavigationPayload(hostname);
      if (nextPayload.videoKey !== subtitleVideoKeyRef.current) {
        subtitleVideoKeyRef.current = nextPayload.videoKey;
        subtitleTimelineRef.current = [];
      }

      startTransition(() => {
        setSubtitleNavigation(nextPayload.state);
      });
    }

    applyPayload(readInitialSubtitleNavigationPayload(hostname));
    const unsubscribeSubtitleNavigation = subscribeOverlaySubtitleNavigationState((next) => {
      applyPayload(next);
    });
    void refreshOverlaySubtitleNavigationState()
      .then(applyPayload)
      .catch(() => {
        // Ignore bridge refresh failures and keep the last known UI state.
      });

    return () => {
      cancelled = true;
      unsubscribeSubtitleNavigation();
    };
  }, [hostname]);

  const profileOptions = useMemo(() => {
    if (!settings) {
      return [];
    }
    return listProfileOptions(settings);
  }, [settings]);

  const profile = useMemo(() => {
    if (!settings) {
      return null;
    }
    return getProfileConfigById(settings, settings.activeProfileId);
  }, [settings]);
  const resolvedTheme = useResolvedTheme(profile ? profile.themeMode : 'auto');

  if (loading) {
    return (
      <div className="bsv-overlay-root" data-theme={resolvedTheme}>
        <LoadingPanel message={status} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bsv-overlay-root" data-theme={resolvedTheme}>
        <ErrorPanel
          title={error.message}
          suggestion={error.suggestion}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  if (!settings || !profile) {
    return null;
  }

  const currentSettings = settings;
  const overlayState = currentSettings.globalControls.overlayState;

  async function commitSettings(updater: (draft: SettingsV3) => SettingsV3, message: string) {
    await commitFromUpdater(updater, message);
  }

  function scheduleProfileCommit(message = '学习设置已保存。') {
    if (profileCommitTimerRef.current) {
      clearTimeout(profileCommitTimerRef.current);
    }
    profileCommitTimerRef.current = setTimeout(() => {
      profileCommitTimerRef.current = null;
      void commitFromUpdater((draft) => draft, message);
    }, PROFILE_COMMIT_DEBOUNCE_MS);
  }

  async function ensureSubtitleTimelineReady(): Promise<SubtitleTimelineItem[]> {
    if (subtitleTimelineRef.current.length > 0) {
      return subtitleTimelineRef.current;
    }

    const subtitleParser = readSubtitleParser();
    if (!subtitleParser || typeof subtitleParser.loadSubtitleTimeline !== 'function') {
      return [];
    }

    const expectedVideoKey = subtitleVideoKeyRef.current;
    try {
      const timeline = normalizeSubtitleTimeline(await subtitleParser.loadSubtitleTimeline());
      if (expectedVideoKey !== subtitleVideoKeyRef.current) {
        return subtitleTimelineRef.current;
      }
      subtitleTimelineRef.current = timeline;
      return subtitleTimelineRef.current;
    } catch {
      return [];
    }
  }

  async function jumpToSubtitle(targetIndex: number | null, message: string) {
    const video = readVideoElement();
    const timeline = await ensureSubtitleTimelineReady();
    const seekedAt = seekVideoToSubtitle(video, timeline, targetIndex);
    if (seekedAt == null) {
      setStatus('当前没有可跳转的字幕句段。');
      return;
    }
    setStatus(`${message}（${seekedAt.toFixed(1)}s）`);
  }

  function patchProfile(patch: Partial<ProfileConfig>, options: { immediate?: boolean } = {}) {
    mutateWorking((draft) => setActiveProfileConfig(draft, draft.activeProfileId, patch));
    if (options.immediate) {
      if (profileCommitTimerRef.current) {
        clearTimeout(profileCommitTimerRef.current);
        profileCommitTimerRef.current = null;
      }
      void commitFromUpdater((draft) => draft, '学习设置已保存。');
      return;
    }
    scheduleProfileCommit('学习设置已保存。');
  }

  function patchOverlayState(patch: Partial<SettingsV3['globalControls']['overlayState']>) {
    void commitSettings((draft) => {
      draft.globalControls.overlayState = { ...draft.globalControls.overlayState, ...patch };
      return draft;
    }, '悬浮面板设置已保存。');
  }

  const hideOverlay = async () => {
    const next = normalizeSettingsV3({
      ...settings,
      globalControls: {
        ...settings.globalControls,
        overlayState: {
          ...settings.globalControls.overlayState,
          hidden: true,
        },
      },
    });
    await commit(next, '已隐藏悬浮面板。');
  };

  const showOverlay = async () => {
    const next = normalizeSettingsV3({
      ...settings,
      globalControls: {
        ...settings.globalControls,
        overlayState: {
          ...settings.globalControls.overlayState,
          hidden: false,
        },
      },
    });
    await commit(next, '悬浮面板已恢复。');
  };

  if (overlayState.hidden) {
    return (
      <div className="bsv-overlay-root" data-theme={resolvedTheme}>
        <button
          type="button"
          className="bsv-fab"
          aria-label="打开学习面板"
          onClick={() => void showOverlay()}
        >
          <BookIcon size={14} />
          打开学习面板
        </button>
      </div>
    );
  }

  return (
    <div className="bsv-overlay-root" data-theme={resolvedTheme}>
      <aside
        className="bsv-overlay-panel"
        data-collapsed={overlayState.collapsed}
        style={{
          ['--bsv-width' as string]: `${overlayState.width}px`,
          ['--bsv-height' as string]: `${overlayState.height}px`,
          ['--bsv-right' as string]: `${overlayState.offsetRight}px`,
          ['--bsv-bottom' as string]: `${overlayState.offsetBottom}px`,
        }}
      >
        <header className="bsv-overlay-head">
          <h3 className="bsv-overlay-title">
            Subtitle Learning
            <strong>
              {profileOptions.find((item) => item.id === settings.activeProfileId)?.name ||
                '均衡输入'}
            </strong>
          </h3>
          <div className="bsv-overlay-actions">
            <button
              type="button"
              className="bsv-btn"
              aria-label={overlayState.collapsed ? '展开面板' : '折叠面板'}
              onClick={() => patchOverlayState({ collapsed: !overlayState.collapsed })}
            >
              {overlayState.collapsed ? <ExpandIcon size={14} /> : <CollapseIcon size={14} />}
              {overlayState.collapsed ? '展开' : '折叠'}
            </button>
            <button
              type="button"
              className="bsv-btn"
              aria-label="隐藏面板"
              onClick={() => void hideOverlay()}
            >
              <HideIcon size={14} />
              隐藏
            </button>
          </div>
        </header>
        {!overlayState.collapsed && (
          <div className="bsv-overlay-body" data-active-tab={activeTab}>
            <nav className="bsv-overlay-tabs" aria-label="悬浮面板内容">
              {OVERLAY_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className="bsv-overlay-tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <section className="bsv-tab-section bsv-tab-section--learn bsv-card bsv-stats-card">
              <h4>今日学习进度</h4>
              <div className="bsv-stats-grid">
                <div className="bsv-stat-item">
                  <span className="bsv-stat-value">{summary.todayCount}</span>
                  <span className="bsv-stat-label">待复习</span>
                </div>
                <div className="bsv-stat-item">
                  <span className="bsv-stat-value">{summary.newCount}</span>
                  <span className="bsv-stat-label">新遇见</span>
                </div>
                <div className="bsv-stat-item">
                  <span className="bsv-stat-value">{summary.masteredCount}</span>
                  <span className="bsv-stat-label">已掌握</span>
                </div>
              </div>
              <div className="bsv-recent-words">
                <div className="bsv-recent-words__head">
                  <strong>最近词汇</strong>
                  <span>跟随学习状态实时刷新</span>
                </div>
                {summary.recentWords.length > 0 ? (
                  <div className="bsv-recent-words__list">
                    {summary.recentWords.slice(0, 3).map((item) => (
                      <div className="bsv-recent-word" key={item.word}>
                        <strong>{item.word}</strong>
                        <span>{getRecentWordMeta(item)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="继续观看带字幕的视频后，这里会显示最近命中的词。" />
                )}
              </div>
            </section>

            <section className="bsv-tab-section bsv-tab-section--learn bsv-card bsv-subtitle-card">
              <div className="bsv-subtitle-head">
                <div className="bsv-subtitle-copy">
                  <h4>字幕导航</h4>
                  <p>{subtitleNavigation.description}</p>
                </div>
                <strong className="bsv-subtitle-progress">
                  {subtitleNavigation.progressLabel}
                </strong>
              </div>
              <div className="bsv-subtitle-current" aria-live="polite">
                <span>{subtitleNavigation.headline}</span>
                <strong>{subtitleNavigation.currentText}</strong>
              </div>
              <div className="bsv-subtitle-actions">
                <button
                  type="button"
                  className="bsv-btn"
                  disabled={subtitleNavigation.previousIndex == null}
                  onClick={() =>
                    void jumpToSubtitle(subtitleNavigation.previousIndex, '已跳到上一句字幕')
                  }
                >
                  <ChevronLeftIcon size={14} />
                  上一句
                </button>
                <button
                  type="button"
                  className="bsv-btn"
                  disabled={subtitleNavigation.replayIndex == null}
                  onClick={() =>
                    void jumpToSubtitle(subtitleNavigation.replayIndex, '已重播当前字幕')
                  }
                >
                  <ReplayIcon size={14} />
                  重播本句
                </button>
                <button
                  type="button"
                  className="bsv-btn"
                  disabled={subtitleNavigation.nextIndex == null}
                  onClick={() =>
                    void jumpToSubtitle(subtitleNavigation.nextIndex, '已跳到下一句字幕')
                  }
                >
                  下一句
                  <ChevronRightIcon size={14} />
                </button>
              </div>
            </section>

            <section className="bsv-tab-section bsv-tab-section--controls bsv-card">
              <h4>配置档与学习强度</h4>
              <div className="bsv-row">
                <div className="bsv-field">
                  <label htmlFor="bsvProfile">配置档</label>
                  <select
                    id="bsvProfile"
                    value={String(settings.activeProfileId)}
                    onChange={(event) => {
                      void commitSettings((draft) => {
                        draft.activeProfileId = event.target.value;
                        return draft;
                      }, '配置档已切换。');
                    }}
                  >
                    {profileOptions.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bsv-field">
                  <label htmlFor="bsvRatio">
                    替换比例：{Math.round(profile.replaceRatio * 100)}%
                  </label>
                  <input
                    id="bsvRatio"
                    type="range"
                    min={0.1}
                    max={0.3}
                    step={0.01}
                    value={profile.replaceRatio}
                    onChange={(event) =>
                      patchProfile({
                        replaceRatio: asNumber(event.target.value, profile.replaceRatio),
                      })
                    }
                    onMouseUp={() => scheduleProfileCommit('学习设置已保存。')}
                    onTouchEnd={() => scheduleProfileCommit('学习设置已保存。')}
                  />
                </div>
              </div>
              <div className="bsv-grid-two">
                <div className="bsv-field">
                  <label htmlFor="bsvMax">单句上限</label>
                  <input
                    id="bsvMax"
                    type="number"
                    min={1}
                    max={5}
                    value={profile.maxReplaceCount}
                    onChange={(event) =>
                      patchProfile(
                        {
                          maxReplaceCount: asNumber(event.target.value, profile.maxReplaceCount),
                        },
                        { immediate: true }
                      )
                    }
                  />
                </div>
                <div className="bsv-field">
                  <label htmlFor="bsvCefr">目标 CEFR</label>
                  <select
                    id="bsvCefr"
                    value={profile.targetCefr}
                    onChange={(event) => patchProfile({ targetCefr: event.target.value })}
                  >
                    {CEFR_LEVELS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="bsv-tab-section bsv-tab-section--controls bsv-card">
              <h4>运行开关</h4>
              <div className="bsv-row">
                <label className="bsv-switch">
                  <span>
                    <strong>字幕替换总开关</strong>
                    启用后按配置档策略替换词汇。
                  </span>
                  <input
                    aria-checked={profile.enabled}
                    aria-label="字幕替换总开关"
                    role="switch"
                    type="checkbox"
                    checked={profile.enabled}
                    onChange={(event) => patchProfile({ enabled: event.target.checked })}
                  />
                </label>
                <label className="bsv-switch">
                  <span>
                    <strong>页面正文模式</strong>
                    控制是否处理页面段落文本。
                  </span>
                  <input
                    aria-checked={settings.globalControls.webPageEnabled}
                    aria-label="页面正文模式"
                    role="switch"
                    type="checkbox"
                    checked={settings.globalControls.webPageEnabled}
                    onChange={(event) => {
                      void commitSettings((draft) => {
                        draft.globalControls.webPageEnabled = event.target.checked;
                        return draft;
                      }, '页面正文模式已保存。');
                    }}
                  />
                </label>
                <label className="bsv-switch">
                  <span>
                    <strong>复习弹幕</strong>
                    在观看过程中回顾已学习词汇。
                  </span>
                  <input
                    aria-checked={settings.globalControls.reviewDanmakuEnabled}
                    aria-label="复习弹幕"
                    role="switch"
                    type="checkbox"
                    checked={settings.globalControls.reviewDanmakuEnabled}
                    onChange={(event) => {
                      void commitSettings((draft) => {
                        draft.globalControls.reviewDanmakuEnabled = event.target.checked;
                        return draft;
                      }, '复习弹幕设置已保存。');
                    }}
                  />
                </label>
                <div className="bsv-field">
                  <label htmlFor="bsvSpeed">复习节奏</label>
                  <select
                    id="bsvSpeed"
                    value={profile.reviewDanmakuSpeed}
                    onChange={(event) =>
                      patchProfile(
                        {
                          reviewDanmakuSpeed: event.target.value as 'slow' | 'normal' | 'fast',
                        },
                        { immediate: true }
                      )
                    }
                  >
                    {REVIEW_SPEEDS.map((item) => (
                      <option key={item} value={item}>
                        {getReviewDanmakuSpeedLabel(item)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bsv-field">
                  <label htmlFor="bsvDensity">复习弹幕密度</label>
                  <select
                    id="bsvDensity"
                    value={profile.reviewDanmakuDensity}
                    onChange={(event) =>
                      patchProfile(
                        {
                          reviewDanmakuDensity: event.target
                            .value as ProfileConfig['reviewDanmakuDensity'],
                        },
                        { immediate: true }
                      )
                    }
                  >
                    {REVIEW_DENSITIES.map((item) => (
                      <option key={item} value={item}>
                        {getReviewDensityLabel(item as ProfileConfig['reviewDanmakuDensity'])}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bsv-field">
                  <label htmlFor="bsvTheme">主题模式</label>
                  <select
                    id="bsvTheme"
                    value={profile.themeMode}
                    onChange={(event) =>
                      patchProfile({
                        themeMode: event.target.value as 'auto' | 'light' | 'dark',
                      })
                    }
                  >
                    {THEME_MODE_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>
                        {getThemeModeLabel(mode)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="bsv-tab-section bsv-tab-section--display bsv-card">
              <h4>面板位置</h4>
              <div className="bsv-shift">
                <button
                  type="button"
                  className="bsv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetRight: clampOffset(overlayState.offsetRight + 12, 12, 360),
                    })
                  }
                >
                  向左
                </button>
                <button
                  type="button"
                  className="bsv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetRight: clampOffset(overlayState.offsetRight - 12, 12, 360),
                    })
                  }
                >
                  向右
                </button>
                <button
                  type="button"
                  className="bsv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetBottom: clampOffset(overlayState.offsetBottom + 12, 24, 240),
                    })
                  }
                >
                  上移
                </button>
                <button
                  type="button"
                  className="bsv-btn"
                  onClick={() =>
                    patchOverlayState({
                      offsetBottom: clampOffset(overlayState.offsetBottom - 12, 24, 240),
                    })
                  }
                >
                  下移
                </button>
              </div>
            </section>

            <footer className="bsv-overlay-foot">
              <span
                className="bsv-status"
                aria-live={SAVE_FAILED_PATTERN.test(status) ? 'assertive' : 'polite'}
                aria-atomic="true"
              >
                {status}
              </span>
              <div className="bsv-shift">
                <button type="button" className="bsv-btn" onClick={() => void hideOverlay()}>
                  <HideIcon size={14} />
                  隐藏面板
                </button>
                {saving && <span className="bsv-saving-pill">保存中...</span>}
              </div>
            </footer>
          </div>
        )}
      </aside>
    </div>
  );
}

function mountOverlayPanel(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(ROOT_ID)) {
    return;
  }
  if (!document.getElementById(STYLE_ID)) {
    const styleNode = document.createElement('style');
    styleNode.id = STYLE_ID;
    styleNode.textContent = `${overlayCss}\n${uiShellCss}`;
    document.documentElement.appendChild(styleNode);
  }
  const rootNode = document.createElement('div');
  rootNode.id = ROOT_ID;
  document.body.appendChild(rootNode);
  createRoot(rootNode).render(<OverlayApp />);
}

declare global {
  interface Window {
    ReactOverlayModule?: {
      mountOverlayPanel: () => void;
    };
  }
}

if (typeof window !== 'undefined') {
  window.ReactOverlayModule = {
    mountOverlayPanel,
  };
}

export { mountOverlayPanel };
