import {
  SCENE_PRESETS,
  cloneSettingsV3,
  getReviewDanmakuDensityLabel,
  getReviewDanmakuSpeedLabel,
  normalizeSettingsV3,
  setActiveProfileConfig,
} from '../lib/settings-bridge';
import type { BuiltinProfileId, SettingsV3 } from '../lib/settings-bridge';
import type { OnboardingGoal, OnboardingState } from '../lib/settings-client';

interface OnboardingGoalMeta {
  title: string;
  subtitle: string;
  description: string;
  profileId: BuiltinProfileId;
}

interface OnboardingPanelProps {
  state: OnboardingState | null;
  busyGoal: OnboardingGoal | 'dismiss' | null;
  onSelectGoal: (goal: OnboardingGoal) => void;
  onDismiss: () => void;
}

const ONBOARDING_GOAL_META: Record<OnboardingGoal, OnboardingGoalMeta> = {
  light: {
    title: '轻量接触',
    subtitle: '15% · 单句 1 词 · 慢速复习',
    description: '优先保证字幕流畅，适合刚安装或首次看新主题。',
    profileId: 'gentle',
  },
  balanced: {
    title: '考试词汇',
    subtitle: '20% · 单句 2 词 · 考试优先',
    description: '保留低打扰节奏，同时优先命中 CET / TOEFL 等考试词。',
    profileId: 'balanced',
  },
  intensive: {
    title: '强化复习',
    subtitle: '30% · 单句 4 词 · 复习弹幕',
    description: '适合复看内容或冲刺阶段，会同步打开复习弹幕。',
    profileId: 'intensive',
  },
};

function shouldShowOnboarding(state: OnboardingState | null): boolean {
  return Boolean(state && !state.completedAt);
}

export function getOnboardingGoalTitle(goal: OnboardingGoal | null): string {
  return goal ? ONBOARDING_GOAL_META[goal].title : '稍后设置';
}

export function applyOnboardingGoal(settings: SettingsV3, goal: OnboardingGoal): SettingsV3 {
  const meta = ONBOARDING_GOAL_META[goal];
  const next = cloneSettingsV3(settings);
  next.activeProfileId = meta.profileId;

  const profilePatch = {
    ...SCENE_PRESETS[goal],
    enabled: true,
    vocabularyMode: 'core' as const,
    examPreference: goal === 'balanced' ? ('exam-first' as const) : ('balanced' as const),
    targetCefr: goal === 'light' ? 'B1' : 'B2',
  };
  const withProfile = setActiveProfileConfig(next, meta.profileId, profilePatch);

  return normalizeSettingsV3({
    ...withProfile,
    globalControls: {
      ...withProfile.globalControls,
      reviewDanmakuEnabled:
        goal === 'intensive' ? true : withProfile.globalControls.reviewDanmakuEnabled,
    },
  });
}

export function OnboardingPanel({
  state,
  busyGoal,
  onSelectGoal,
  onDismiss,
}: OnboardingPanelProps) {
  if (!shouldShowOnboarding(state)) {
    return null;
  }

  return (
    <section className="panel onboarding-panel stack stagger-enter">
      <div className="inline wrap">
        <div>
          <h3>30 秒上手</h3>
          <p className="panel-subtitle">
            选择一个目标后会直接套用推荐策略，并保留后续精细调整入口。
          </p>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={onDismiss}
          disabled={Boolean(busyGoal)}
        >
          {busyGoal === 'dismiss' ? '处理中...' : '稍后'}
        </button>
      </div>

      <div className="onboarding-goal-grid">
        {(Object.keys(ONBOARDING_GOAL_META) as OnboardingGoal[]).map((goal) => {
          const preset = SCENE_PRESETS[goal];
          const meta = ONBOARDING_GOAL_META[goal];
          return (
            <button
              key={goal}
              type="button"
              className="onboarding-goal-card"
              data-onboarding-goal={goal}
              onClick={() => onSelectGoal(goal)}
              disabled={Boolean(busyGoal)}
            >
              <span className="onboarding-goal-card__kicker">
                {Math.round(preset.replaceRatio * 100)}% · {preset.maxReplaceCount} 词 ·{' '}
                {getReviewDanmakuSpeedLabel(preset.reviewDanmakuSpeed)} ·{' '}
                {getReviewDanmakuDensityLabel(preset.reviewDanmakuDensity)}
              </span>
              <strong>{busyGoal === goal ? '应用中...' : meta.title}</strong>
              <span>{meta.description}</span>
            </button>
          );
        })}
      </div>

      <div className="onboarding-steps">
        <span>1. 选目标</span>
        <span>2. 看预演</span>
        <span>3. 直接启用</span>
      </div>
    </section>
  );
}
