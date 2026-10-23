import { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/ui.css';
import {
  cloneSettingsV3,
  getProfileConfigById,
  isDomainEnabled,
  listProfileOptions,
  ProfileConfig,
  setExactDomainRuleEnabled,
  setActiveProfileConfig,
} from '../lib/settings-bridge';
import { getSiteToggleUiState } from '../lib/site-toggle-state';
import { ExperienceMetricsSnapshot, openOptionsPage } from '../lib/settings-client';
import { getRankingSummaryText } from '../lib/learning-dashboard';
import { useDocumentTheme } from '../lib/bsv-theme';
import { useV3Settings } from '../hooks/use-v3-settings';
import { LoadingPanel, ErrorPanel } from './ui-shell';
import { useQuickReview } from '../hooks/use-quick-review';
import { useSubtitleStatus } from '../hooks/use-subtitle-status';
import { useSitePermission } from '../hooks/use-site-permission';
import { useAdaptiveTuning } from '../hooks/use-adaptive-tuning';
import { useLearningStreak } from '../hooks/use-learning-streak';
import { useUndoAction } from '../hooks/use-undo-action';
import {
  SiteControlSection,
  AdaptiveTuningSection,
  SubtitleNavSection,
  QuickReviewSection,
  WordRankingSection,
  TodayMetricsSection,
  ConflictSection,
  UndoSection,
} from './popup-sections';
import { ExternalLinkIcon } from './icons';

const EMPTY_EXPERIENCE_METRICS: ExperienceMetricsSnapshot = {
  windowDays: 7,
  updatedAt: null,
  contextMisreplaceReported: 0,
  contextMisreplaceHigh: 0,
  adaptiveDecisionApplied: 0,
  adaptiveManualOverride: 0,
  adaptiveToggleEnabled: 0,
  adaptiveToggleDisabled: 0,
  adaptiveToggleTotal: 0,
  adaptiveToggleDisableRate: 0,
};

const BILINGUAL_MODE_OPTIONS: Array<{ value: ProfileConfig['bilingualMode']; label: string }> = [
  { value: 'default', label: '括号释义' },
  { value: 'bilingual', label: '双语对照' },
  { value: 'english-only', label: '纯英文' },
];

const THEME_MODE_OPTIONS: Array<{ value: ProfileConfig['themeMode']; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

function getSiteStatusView({
  hostname,
  profileEnabled,
  siteRuleEnabled,
  sitePermission,
}: {
  hostname: string;
  profileEnabled: boolean;
  siteRuleEnabled: boolean;
  sitePermission: {
    defaultSupported: boolean;
    authorized: boolean;
    canRequest: boolean;
    message: string;
  };
}): {
  badge: string;
  tone: 'good' | 'warn';
  headline: string;
  description: string;
} {
  if (!hostname) {
    return {
      badge: '未识别',
      tone: 'warn',
      headline: '当前页面无法识别域名',
      description: '请切换到可识别的站点后，再调整当前站点的运行状态。',
    };
  }

  if (!profileEnabled) {
    return {
      badge: '总开关关闭',
      tone: 'warn',
      headline: '当前配置档已关闭字幕替换',
      description: '恢复总开关后，当前站点会继续按站点规则运行。',
    };
  }

  if (!siteRuleEnabled) {
    return {
      badge: '已暂停',
      tone: 'warn',
      headline: `${hostname} 当前已暂停`,
      description: '该站点已被本地规则暂停；需要时可直接恢复。',
    };
  }

  if (sitePermission.defaultSupported) {
    return {
      badge: '已启用',
      tone: 'good',
      headline: `${hostname} 当前已启用`,
      description: '默认支持站点已随扩展安装授权，可直接运行。',
    };
  }

  if (sitePermission.authorized) {
    return {
      badge: '已授权',
      tone: 'good',
      headline: `${hostname} 已允许运行`,
      description: sitePermission.message,
    };
  }

  if (sitePermission.canRequest) {
    return {
      badge: '待授权',
      tone: 'warn',
      headline: `${hostname} 需要先授权`,
      description: sitePermission.message,
    };
  }

  return {
    badge: '受限',
    tone: 'warn',
    headline: `${hostname} 当前不可运行`,
    description: sitePermission.message,
  };
}

function PopupApp() {
  const {
    working,
    loading,
    saving,
    dirty,
    conflict,
    status,
    statusCode,
    feedback,
    setStatus,
    setWorkingDirect,
    save,
    reload,
    resolveConflictUseRemote,
    resolveConflictUseLocal,
  } = useV3Settings({
    initialStatus: '正在读取配置...',
  });

  const {
    summary,
    quickReview,
    reviewSubmitting,
    quickReviewCard,
    encounteredRanking,
    rankingSortMode,
    setRankingSortMode,
    cycleQuickReviewCard,
    handleQuickReviewAction,
  } = useQuickReview(setStatus);

  const { subtitleNavigation, subtitleActionBusy, onNavigateSubtitle, canUseSubtitleAction } =
    useSubtitleStatus(setStatus);

  const { sitePermission, hostname, permissionRequesting, onToggleSitePermission } =
    useSitePermission(setStatus);

  const { adaptiveState, experienceMetrics, adaptiveBusy, onToggleAdaptive } =
    useAdaptiveTuning(setStatus);

  const { learningStreak } = useLearningStreak(setStatus);

  const { pendingUndo, registerUndo, undoAction, clearUndo } = useUndoAction();

  const activeProfile = useMemo(() => {
    if (!working) return null;
    return getProfileConfigById(working, working.activeProfileId);
  }, [working]);

  const profileOptions = useMemo(() => (working ? listProfileOptions(working) : []), [working]);
  const activeProfileName =
    profileOptions.find((item) => working && item.id === working.activeProfileId)?.name ||
    '均衡输入';

  useDocumentTheme(activeProfile ? activeProfile.themeMode : 'auto');

  const siteRuleEnabled = useMemo(() => {
    if (!working || !hostname) return true;
    return isDomainEnabled(hostname, {
      enabled: true,
      domainRules: working.globalControls.siteRules,
    });
  }, [working, hostname]);

  const siteToggleState = useMemo(
    () =>
      getSiteToggleUiState({
        hostname,
        profileEnabled: activeProfile ? activeProfile.enabled : true,
        siteRuleEnabled,
      }),
    [activeProfile, hostname, siteRuleEnabled]
  );

  const siteStatus = useMemo(
    () =>
      getSiteStatusView({
        hostname,
        profileEnabled: activeProfile ? activeProfile.enabled : true,
        siteRuleEnabled,
        sitePermission,
      }),
    [activeProfile, hostname, sitePermission, siteRuleEnabled]
  );

  const rankingSummary = useMemo(
    () => getRankingSummaryText(encounteredRanking, rankingSortMode),
    [encounteredRanking, rankingSortMode]
  );

  const resolvedExperienceMetrics = experienceMetrics ?? EMPTY_EXPERIENCE_METRICS;

  const statusCodeText = statusCode ? `（${statusCode}）` : '';

  async function onToggleCurrentSite() {
    if (!working || siteToggleState.buttonDisabled) {
      setStatus(siteToggleState.hint);
      return;
    }

    if (!siteRuleEnabled && !sitePermission.defaultSupported && !sitePermission.authorized) {
      setStatus('需要先授权当前站点，再恢复站点运行。');
      return;
    }

    const before = cloneSettingsV3(working);
    const next = cloneSettingsV3(working);
    next.globalControls.siteRules = setExactDomainRuleEnabled(
      next.globalControls.siteRules,
      hostname,
      !siteRuleEnabled
    );
    setWorkingDirect(next);

    const saveResult = await save(
      siteRuleEnabled
        ? `已暂停站点 ${hostname}，6 秒内可撤销。`
        : `已恢复站点 ${hostname}，6 秒内可撤销。`
    );
    if (!saveResult) {
      setWorkingDirect(before);
      return;
    }
    registerUndo(before, siteRuleEnabled ? `已暂停站点 ${hostname}` : `已恢复站点 ${hostname}`);
  }

  async function updatePopupProfile(patch: Partial<ProfileConfig>) {
    if (!working) return;
    const next = setActiveProfileConfig(working, working.activeProfileId, patch);
    setWorkingDirect(next);
    await save('弹窗显示设置已保存。');
  }

  async function onResolveConflictUseLocal() {
    const result = await resolveConflictUseLocal('已应用本地版本，并覆盖外部修改。');
    if (!result) return;
    if (result.preservedLocalEdits) {
      setStatus('本地版本已覆盖远端，当前仍有未保存修改。');
    }
  }

  function onResolveConflictUseRemote(msg: string) {
    resolveConflictUseRemote(msg);
    clearUndo();
  }

  function onUndoPendingAction() {
    return undoAction(setWorkingDirect, save, setStatus);
  }

  if (!working || !activeProfile) {
    const isError = !loading && feedback?.stage === 'error';
    const statusMessage = `${status}${statusCode ? `（${statusCode}）` : ''}`;
    return (
      <main className="popup-shell">
        {loading ? (
          <LoadingPanel message={statusMessage} />
        ) : (
          <section className="studio-hero stagger-enter">
            <span className="studio-eyebrow">Quick Control</span>
            <h1 className="studio-title">配置不可用</h1>
            <p className="studio-subtitle">{statusMessage}</p>
          </section>
        )}
        {isError && (
          <ErrorPanel
            title="读取配置失败"
            suggestion={feedback?.suggestion}
            onRetry={() => void reload()}
          />
        )}
      </main>
    );
  }

  return (
    <main className="popup-shell">
      <header className="popup-appbar">
        <div className="popup-brand">
          <span className="popup-brand__mark">SV</span>
          <span>
            <strong>字幕学习助手</strong>
            <small>
              {activeProfileName} · {dirty ? '有未保存修改' : '已同步'}
            </small>
          </span>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="打开设置"
          title="打开设置"
          onClick={() => void openOptionsPage()}
        >
          <ExternalLinkIcon size={15} />
        </button>
      </header>

      <SiteControlSection
        sitePermission={sitePermission}
        siteToggleState={siteToggleState}
        siteStatus={siteStatus}
        permissionRequesting={permissionRequesting}
        saving={saving}
        onToggleCurrentSite={onToggleCurrentSite}
        onToggleSitePermission={onToggleSitePermission}
      />

      {conflict && (
        <ConflictSection
          conflict={conflict}
          saving={saving}
          resolveConflictUseRemote={onResolveConflictUseRemote}
          resolveConflictUseLocal={onResolveConflictUseLocal}
        />
      )}

      {pendingUndo && (
        <UndoSection pendingUndo={pendingUndo} saving={saving} onUndo={onUndoPendingAction} />
      )}

      <section className="popup-primary-flow">
        <TodayMetricsSection summary={summary} learningStreak={learningStreak} />

        <QuickReviewSection
          quickReviewCard={quickReviewCard}
          summary={summary}
          reviewSubmitting={reviewSubmitting}
          quickReviewItemsLength={quickReview.items.length}
          cycleQuickReviewCard={cycleQuickReviewCard}
          handleQuickReviewAction={handleQuickReviewAction}
        />

        <SubtitleNavSection
          subtitleNavigation={subtitleNavigation}
          subtitleActionBusy={subtitleActionBusy}
          onNavigateSubtitle={onNavigateSubtitle}
          canUseSubtitleAction={canUseSubtitleAction}
        />
      </section>

      <details className="popup-more" open={Boolean(conflict || feedback?.stage === 'error')}>
        <summary>更多控制与学习统计</summary>
        <section className="panel stack">
          <div className="grid-two">
            <div className="field">
              <label htmlFor="popupBilingualMode">显示模式</label>
              <select
                id="popupBilingualMode"
                value={activeProfile.bilingualMode}
                onChange={(event) =>
                  void updatePopupProfile({
                    bilingualMode: event.target.value as ProfileConfig['bilingualMode'],
                  })
                }
                disabled={saving}
              >
                {BILINGUAL_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="popupThemeMode">主题模式</label>
              <select
                id="popupThemeMode"
                value={activeProfile.themeMode}
                onChange={(event) =>
                  void updatePopupProfile({
                    themeMode: event.target.value as ProfileConfig['themeMode'],
                  })
                }
                disabled={saving}
              >
                {THEME_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
        <AdaptiveTuningSection
          adaptiveState={adaptiveState}
          experienceMetrics={resolvedExperienceMetrics}
          adaptiveBusy={adaptiveBusy}
          onToggleAdaptive={onToggleAdaptive}
        />
        <WordRankingSection
          encounteredRanking={encounteredRanking}
          rankingSortMode={rankingSortMode}
          rankingSummary={rankingSummary}
          learningStreak={learningStreak}
          setRankingSortMode={setRankingSortMode}
        />
      </details>

      <section
        className="panel stack stagger-enter"
        aria-live={feedback && feedback.stage === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        <p className={`status-text ${feedback ? `status-text--${feedback.stage}` : ''}`}>
          {status}
          {statusCodeText}
        </p>
        {feedback && feedback.suggestion && <p className="panel-subtitle">{feedback.suggestion}</p>}
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root for popup app');
}
createRoot(rootElement).render(<PopupApp />);
