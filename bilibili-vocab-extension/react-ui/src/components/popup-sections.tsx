import { useEffect, useState } from 'react';
import { EmptyState } from './ui-shell';
import { ActiveTabSitePermissionState } from '../lib/permission-service';
import {
  ActiveTabSubtitleNavigation,
  ActiveTabSubtitleNavigationAction,
} from '../lib/subtitle-navigation-client';
import { AdaptiveTuningState, ExperienceMetricsSnapshot } from '../lib/settings-client';
import { LearningStreak, LearningSummary } from '../lib/learning-client';
import {
  EncounteredWordRankingItem,
  EncounteredWordSortMode,
  QuickReviewAction,
  QuickReviewCardState,
  formatReviewCountText,
  getRelativeSeenText,
} from '../lib/learning-dashboard';

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function formatLearningStreakHeadline(streak: LearningStreak): string {
  if (streak.currentStreak > 0) {
    return `已连续学习 ${streak.currentStreak} 天`;
  }
  return '连续学习尚未开始';
}

function formatLearningStreakMeta(streak: LearningStreak): string {
  const parts = [`总学习 ${streak.totalActiveDays} 天`, `最长 ${streak.maxStreak} 天`];
  if (streak.lastActiveDate) {
    parts.push(
      streak.lastActiveDate === getTodayDateString()
        ? '今天已记录学习活动'
        : `上次活跃 ${streak.lastActiveDate}`
    );
  } else {
    parts.push('完成任一学习动作后会开始计数');
  }
  return parts.join(' · ');
}

function formatPercent(value: number): string {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return `${Math.round(normalized * 100)}%`;
}

function formatAdaptiveLastApplied(state: AdaptiveTuningState | null): string {
  if (!state || !state.lastAppliedAt) {
    return '尚未自动调整';
  }
  return `上次调优：${new Date(state.lastAppliedAt).toLocaleString()}`;
}

function formatManualOverride(state: AdaptiveTuningState | null): string {
  if (!state || !state.manualOverrideActive || state.manualOverrideRemainingMs <= 0) {
    return '当前没有人工覆盖窗口';
  }
  const minutes = Math.max(1, Math.ceil(state.manualOverrideRemainingMs / 60000));
  return `人工覆盖剩余约 ${minutes} 分钟`;
}

function getPermissionActionLabel(
  sitePermission: ActiveTabSitePermissionState,
  permissionRequesting: boolean
): string {
  if (permissionRequesting) {
    return '处理中...';
  }
  if (sitePermission.defaultSupported) {
    return '默认支持站点';
  }
  if (sitePermission.authorized) {
    return sitePermission.canRevoke ? '撤销授权' : '已授权';
  }
  return '授权当前站点';
}

interface SiteControlSectionProps {
  sitePermission: ActiveTabSitePermissionState;
  siteToggleState: { buttonDisabled: boolean; buttonLabel: string; hint: string };
  siteStatus: { badge: string; tone: 'good' | 'warn'; headline: string; description: string };
  permissionRequesting: boolean;
  saving: boolean;
  onToggleCurrentSite: () => Promise<void>;
  onToggleSitePermission: () => void;
}

export function SiteControlSection({
  sitePermission,
  siteToggleState,
  siteStatus,
  permissionRequesting,
  saving,
  onToggleCurrentSite,
  onToggleSitePermission,
}: SiteControlSectionProps) {
  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>当前站点控制</h3>
          <p className="panel-subtitle">只保留当前页面最关键的启停与授权操作。</p>
        </div>
        <span className={`badge ${siteStatus.tone}`}>{siteStatus.badge}</span>
      </div>
      <div className="summary-item">
        <strong>{siteStatus.headline}</strong>
        <span>{siteStatus.description}</span>
      </div>
      <p className="panel-subtitle">
        拒绝授权不会恢复站点规则；如需重新启用，请授权后再恢复站点运行。
      </p>
      <div className="btn-row">
        <button
          type="button"
          className="btn secondary"
          onClick={() => void onToggleCurrentSite()}
          disabled={siteToggleState.buttonDisabled || saving}
        >
          {saving ? '处理中...' : siteToggleState.buttonLabel}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onToggleSitePermission}
          disabled={
            permissionRequesting ||
            saving ||
            (!sitePermission.canRequest && !sitePermission.canRevoke)
          }
        >
          {getPermissionActionLabel(sitePermission, permissionRequesting)}
        </button>
      </div>
    </section>
  );
}

interface AdaptiveTuningSectionProps {
  adaptiveState: AdaptiveTuningState | null;
  experienceMetrics: ExperienceMetricsSnapshot;
  adaptiveBusy: boolean;
  onToggleAdaptive: (checked: boolean) => Promise<void>;
}

export function AdaptiveTuningSection({
  adaptiveState,
  experienceMetrics,
  adaptiveBusy,
  onToggleAdaptive,
}: AdaptiveTuningSectionProps) {
  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>自动调优状态</h3>
          <p className="panel-subtitle">根据误替换反馈和复习行为自动微调策略。</p>
        </div>
        <span className={`badge ${adaptiveState && adaptiveState.enabled ? 'good' : 'warn'}`}>
          {adaptiveState && adaptiveState.enabled ? '运行中' : '已关闭'}
        </span>
      </div>
      <label className="switch-row">
        <span>
          <strong>启用自动调优</strong>
          <small>{adaptiveState ? adaptiveState.hint : '自动调优状态读取中。'}</small>
        </span>
        <input
          aria-checked={adaptiveState ? adaptiveState.enabled : false}
          role="switch"
          type="checkbox"
          checked={adaptiveState ? adaptiveState.enabled : false}
          onChange={(event) => void onToggleAdaptive(event.target.checked)}
          disabled={adaptiveBusy}
        />
      </label>
      <div className="summary-item">
        <strong>{formatAdaptiveLastApplied(adaptiveState)}</strong>
        <span>{formatManualOverride(adaptiveState)}</span>
      </div>
      <h4>近 7 天关键指标</h4>
      <div className="popup-metrics">
        <div className="popup-metric">
          <span>自动决策</span>
          <strong>{experienceMetrics.adaptiveDecisionApplied}</strong>
        </div>
        <div className="popup-metric">
          <span>误替换反馈</span>
          <strong>{experienceMetrics.contextMisreplaceReported}</strong>
        </div>
        <div className="popup-metric">
          <span>关闭率</span>
          <strong>{formatPercent(experienceMetrics.adaptiveToggleDisableRate)}</strong>
        </div>
      </div>
    </section>
  );
}

interface SubtitleNavSectionProps {
  subtitleNavigation: ActiveTabSubtitleNavigation;
  subtitleActionBusy: ActiveTabSubtitleNavigationAction | null;
  onNavigateSubtitle: (action: ActiveTabSubtitleNavigationAction) => Promise<void>;
  canUseSubtitleAction: (action: ActiveTabSubtitleNavigationAction) => boolean;
}

export function SubtitleNavSection({
  subtitleNavigation,
  subtitleActionBusy,
  onNavigateSubtitle,
  canUseSubtitleAction,
}: SubtitleNavSectionProps) {
  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>当前字幕导航</h3>
          <p className="panel-subtitle">直接控制当前标签页的上一句、重播和下一句。</p>
        </div>
        <span className={`badge ${subtitleNavigation.supported ? 'good' : 'warn'}`}>
          {subtitleNavigation.progressLabel}
        </span>
      </div>
      <div className="summary-item">
        <strong>{subtitleNavigation.headline}</strong>
        <span>{subtitleNavigation.description}</span>
      </div>
      <p className="review-card__description">{subtitleNavigation.currentText}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn ghost"
          onClick={() => void onNavigateSubtitle('previous')}
          disabled={!canUseSubtitleAction('previous') || !!subtitleActionBusy}
        >
          {subtitleActionBusy === 'previous' ? '跳转中...' : '上一句'}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void onNavigateSubtitle('replay')}
          disabled={!canUseSubtitleAction('replay') || !!subtitleActionBusy}
        >
          {subtitleActionBusy === 'replay' ? '跳转中...' : '重播本句'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void onNavigateSubtitle('next')}
          disabled={!canUseSubtitleAction('next') || !!subtitleActionBusy}
        >
          {subtitleActionBusy === 'next' ? '跳转中...' : '下一句'}
        </button>
      </div>
    </section>
  );
}

interface QuickReviewSectionProps {
  quickReviewCard: QuickReviewCardState;
  summary: LearningSummary;
  reviewSubmitting: QuickReviewAction | null;
  quickReviewItemsLength: number;
  cycleQuickReviewCard: () => void;
  handleQuickReviewAction: (action: QuickReviewAction) => Promise<void>;
}

export function QuickReviewSection({
  quickReviewCard,
  summary,
  reviewSubmitting,
  quickReviewItemsLength,
  cycleQuickReviewCard,
  handleQuickReviewAction,
}: QuickReviewSectionProps) {
  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>快速复习</h3>
          <p className="panel-subtitle">优先处理当前最值得复习的一张卡片。</p>
        </div>
        <span className={`badge ${quickReviewCard.empty ? '' : 'good'}`}>
          {formatReviewCountText(summary)}
        </span>
      </div>
      <div className={`review-card${quickReviewCard.empty ? ' review-card--empty' : ''}`}>
        {quickReviewCard.empty ? (
          <EmptyState message="今日没有待复习的单词，继续观看即可积累。" />
        ) : (
          <>
            <div className="review-card__head">
              <strong>{quickReviewCard.title}</strong>
              <span>
                {quickReviewCard.total
                  ? `${quickReviewCard.currentIndex + 1} / ${quickReviewCard.total}`
                  : '等待新词'}
              </span>
            </div>
            <p className="review-card__meta">{quickReviewCard.meta}</p>
            <p className="review-card__description">{quickReviewCard.description}</p>
          </>
        )}
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn ghost"
          onClick={cycleQuickReviewCard}
          disabled={quickReviewCard.empty || quickReviewItemsLength <= 1 || !!reviewSubmitting}
        >
          换一张
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void handleQuickReviewAction('know')}
          disabled={quickReviewCard.empty || !!reviewSubmitting}
        >
          {reviewSubmitting === 'know' ? '提交中...' : '认识'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void handleQuickReviewAction('fuzzy')}
          disabled={quickReviewCard.empty || !!reviewSubmitting}
        >
          {reviewSubmitting === 'fuzzy' ? '提交中...' : '模糊'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void handleQuickReviewAction('dontknow')}
          disabled={quickReviewCard.empty || !!reviewSubmitting}
        >
          {reviewSubmitting === 'dontknow' ? '提交中...' : '不认识'}
        </button>
      </div>
    </section>
  );
}

interface WordRankingSectionProps {
  encounteredRanking: EncounteredWordRankingItem[];
  rankingSortMode: EncounteredWordSortMode;
  rankingSummary: string;
  learningStreak: LearningStreak;
  setRankingSortMode: (mode: EncounteredWordSortMode) => void;
}

export function WordRankingSection({
  encounteredRanking,
  rankingSortMode,
  rankingSummary,
  learningStreak,
  setRankingSortMode,
}: WordRankingSectionProps) {
  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>生词排行</h3>
          <p className="panel-subtitle">按命中次数找出最需要巩固的词。</p>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setRankingSortMode(rankingSortMode === 'asc' ? 'desc' : 'asc')}
        >
          {rankingSortMode === 'asc' ? '查看高频' : '查看待巩固'}
        </button>
      </div>
      <div className="summary-item">
        <strong>{rankingSummary}</strong>
        <span>连续学习：{formatLearningStreakHeadline(learningStreak)}</span>
      </div>
      {encounteredRanking.length ? (
        <div className="stack">
          {encounteredRanking.map((item) => (
            <div className="summary-item" key={item.word}>
              <strong>
                {item.word} {item.translation ? `· ${item.translation}` : ''}
              </strong>
              <span>
                {item.level || 'WORD'} · 命中 {item.hitCount} 次 ·{' '}
                {getRelativeSeenText(item.lastSeen)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">等待词汇命中后显示排行。</div>
      )}
    </section>
  );
}

interface TodayMetricsSectionProps {
  summary: LearningSummary;
  learningStreak: LearningStreak;
}

export function TodayMetricsSection({ summary, learningStreak }: TodayMetricsSectionProps) {
  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>今日关键指标</h3>
          <p className="panel-subtitle">只看今天最关键的学习进度。</p>
        </div>
        <span className={`badge ${learningStreak.currentStreak > 0 ? 'good' : ''}`}>
          {learningStreak.currentStreak > 0 ? `${learningStreak.currentStreak} 天连学` : '今日进度'}
        </span>
      </div>
      <div className="popup-metrics">
        <div className="popup-metric">
          <span>今日待复习</span>
          <strong>{summary.todayCount}</strong>
        </div>
        <div className="popup-metric">
          <span>新增词</span>
          <strong>{summary.newCount}</strong>
        </div>
        <div className="popup-metric">
          <span>已掌握</span>
          <strong>{summary.masteredCount}</strong>
        </div>
      </div>
      <div className="summary-item">
        <strong>{formatLearningStreakHeadline(learningStreak)}</strong>
        <span>{formatLearningStreakMeta(learningStreak)}</span>
      </div>
    </section>
  );
}

interface ConflictSectionProps {
  conflict: { summary: string } | null;
  saving: boolean;
  resolveConflictUseRemote: (msg: string) => void;
  resolveConflictUseLocal: () => Promise<void>;
}

export function ConflictSection({
  conflict,
  saving,
  resolveConflictUseRemote,
  resolveConflictUseLocal,
}: ConflictSectionProps) {
  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>检测到并发修改</h3>
          <p className="panel-subtitle">当前弹窗配置与外部保存版本不一致。</p>
        </div>
        <span className="badge warn">冲突</span>
      </div>
      <div className="summary-item">
        <strong>冲突范围：{conflict!.summary}</strong>
        <span>可应用远端版本，或应用本地版本覆盖远端。</span>
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn ghost"
          onClick={() => resolveConflictUseRemote('已应用远端版本，当前与最新配置同步。')}
          disabled={saving}
        >
          应用远端版本
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() => void resolveConflictUseLocal()}
          disabled={saving}
        >
          应用本地版本
        </button>
      </div>
    </section>
  );
}

interface UndoSectionProps {
  pendingUndo: { label: string; expiresAt?: number } | null;
  saving: boolean;
  onUndo: () => Promise<void>;
}

export function UndoSection({ pendingUndo, saving, onUndo }: UndoSectionProps) {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!pendingUndo || !pendingUndo.expiresAt) {
      setRemainingMs(0);
      return () => {};
    }
    const update = () => setRemainingMs(Math.max(0, pendingUndo.expiresAt! - Date.now()));
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [pendingUndo]);

  const totalMs = 6000;
  const progress = pendingUndo && remainingMs > 0 ? remainingMs / totalMs : 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <section className="panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>{pendingUndo!.label}</h3>
          <p className="panel-subtitle">{secondsLeft} 秒内可撤销。</p>
        </div>
        <button type="button" className="btn ghost" onClick={() => void onUndo()} disabled={saving}>
          撤销该操作
        </button>
      </div>
      <div className="undo-progress" role="timer" aria-label="撤销倒计时">
        <span className="undo-progress__bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </section>
  );
}
