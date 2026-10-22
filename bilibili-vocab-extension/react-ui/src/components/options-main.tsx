import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/ui.css';
import { clearVocabularyBook } from '../lib/vocabulary-export';
import {
  BUILTIN_PROFILE_IDS,
  MAX_CUSTOM_PROFILES,
  SCENE_PRESETS,
  ProfileConfig,
  ScenePresetKey,
  SettingsV3,
  cloneSettingsV3,
  createResetSettingsSnapshot,
  getProfileConfigById,
  getPresetKeyFromSettings,
  listProfileOptions,
  normalizeDomainRules,
  normalizeHostname,
  parseImportedSettingsText,
  removeCustomProfile,
  resolveEffectiveRuntime,
  setActiveProfileConfig,
  setExactDomainRuleEnabled,
  upsertCustomProfile,
} from '../lib/settings-bridge';
import { OnboardingPanel } from './onboarding';
import { LoadingPanel, ErrorPanel } from './ui-shell';
import { useDocumentTheme } from '../lib/bsv-theme';
import { useV3Settings } from '../hooks/use-v3-settings';
import { useAdaptiveTuning } from '../hooks/use-adaptive-tuning';
import { useLearningStreak } from '../hooks/use-learning-streak';
import { useOnboarding } from '../hooks/use-onboarding';
import { useUndoAction } from '../hooks/use-undo-action';
import {
  BasicSettingsSection,
  LearningStrategySection,
  SitesManagementSection,
  DisplaySection,
  DataBackupSection,
  SCENE_PRESET_META,
  MaintenanceAction,
} from './options-sections';
import { SaveIcon, UndoIcon } from './icons';
import { SyncSection } from './sync-section';

type SectionKey = 'basic' | 'learning' | 'sites' | 'display' | 'data' | 'sync';

const SECTION_META: Array<{ id: SectionKey; name: string; description: string; icon: string }> = [
  { id: 'basic', name: '基础设置', description: '配置档、全局开关和状态摘要', icon: '⌘' },
  { id: 'learning', name: '学习策略', description: '替换强度、词库和复习节奏', icon: '◎' },
  { id: 'sites', name: '站点管理', description: '域名规则和授权说明', icon: '⌁' },
  { id: 'display', name: '显示与交互', description: '主题、悬浮面板和快捷键', icon: '◐' },
  { id: 'data', name: '数据与备份', description: '导入导出、恢复默认和清理', icon: '□' },
  { id: 'sync', name: '学习记录同步', description: '与安卓 App 共用的学习事实', icon: '⇄' },
];

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function OptionsApp() {
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
    mutateWorking,
    save,
    reset,
    reload,
    resolveConflictUseRemote,
    resolveConflictUseLocal,
  } = useV3Settings();

  const { adaptiveState, experienceMetrics, onToggleAdaptive, refreshAfterSave } =
    useAdaptiveTuning(setStatus);
  const { learningStreak } = useLearningStreak(setStatus);
  const { onboardingState, onboardingBusy, completeOnboardingFlow } = useOnboarding(setStatus);
  const { pendingUndo, registerUndo, undoAction, clearUndo } = useUndoAction();

  const [section, setSection] = useState<SectionKey>('basic');
  const [newSite, setNewSite] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [maintenanceBusy, setMaintenanceBusy] = useState<MaintenanceAction | null>(null);
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    resolve: ((value: boolean) => void) | null;
  }>({ open: false, title: '', message: '', resolve: null });
  const importSettingsInputRef = useRef<HTMLInputElement>(null);

  function requestConfirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirm({ open: true, title, message, resolve });
    });
  }

  function closeConfirm(result: boolean) {
    const { resolve } = confirm;
    setConfirm({ open: false, title: '', message: '', resolve: null });
    resolve?.(result);
  }

  const activeProfile = useMemo(() => {
    if (!working) return null;
    return getProfileConfigById(working, working.activeProfileId);
  }, [working]);

  useDocumentTheme(activeProfile ? activeProfile.themeMode : 'auto');

  const profileOptions = useMemo(() => (working ? listProfileOptions(working) : []), [working]);
  const activeProfileName =
    profileOptions.find((item) => working && item.id === working.activeProfileId)?.name ||
    '均衡输入';
  const siteRules = useMemo(() => {
    if (!working) return [];
    return Object.entries(working.globalControls.siteRules).sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }, [working]);
  const runtimePreview = useMemo(
    () => (working ? resolveEffectiveRuntime(working, 'www.bilibili.com') : null),
    [working]
  );
  const activePresetKey = useMemo<ScenePresetKey>(
    () => (activeProfile ? getPresetKeyFromSettings(activeProfile) : 'balanced'),
    [activeProfile]
  );
  const isBuiltinActive = useMemo(() => {
    if (!working) return false;
    return BUILTIN_PROFILE_IDS.includes(
      working.activeProfileId as (typeof BUILTIN_PROFILE_IDS)[number]
    );
  }, [working]);

  function updateWorking(updater: (draft: SettingsV3) => SettingsV3) {
    mutateWorking(updater);
  }

  function registerHighRiskUndo(snapshot: SettingsV3, label: string) {
    registerUndo(snapshot, label);
    setStatus(`${label}，6 秒内可撤销。`);
  }

  function patchActiveProfile(patch: Partial<ProfileConfig>) {
    mutateWorking((draft) => setActiveProfileConfig(draft, draft.activeProfileId, patch));
  }

  function setGlobalControls(patch: Partial<SettingsV3['globalControls']>) {
    updateWorking((draft) => {
      draft.globalControls = { ...draft.globalControls, ...patch };
      return draft;
    });
  }

  function onLevelToggle(level: string, checked: boolean) {
    if (!activeProfile) return;
    const selected = new Set(activeProfile.activeLevels);
    if (checked) selected.add(level);
    else selected.delete(level);
    patchActiveProfile({ activeLevels: Array.from(selected) });
  }

  function applyScenePreset(presetKey: ScenePresetKey) {
    patchActiveProfile(SCENE_PRESETS[presetKey]);
    setStatus(`已应用${SCENE_PRESET_META[presetKey].title}预设，记得保存配置。`);
  }

  function onAddCustomProfile() {
    if (!working || !activeProfile) return;
    if (working.profilesCustom.length >= MAX_CUSTOM_PROFILES) {
      setStatus(`最多创建 ${MAX_CUSTOM_PROFILES} 个自定义配置档。`);
      return;
    }
    const fallbackName = `自定义 ${working.profilesCustom.length + 1}`;
    const profileName = newProfileName.trim() || fallbackName;
    const next = upsertCustomProfile(working, { name: profileName, config: activeProfile });
    const created = next.profilesCustom.find(
      (item) =>
        item.name === profileName ||
        item.id === profileName.trim().toLowerCase().replace(/\s+/g, '-')
    );
    setWorkingDirect({
      ...next,
      activeProfileId: created ? created.id : next.activeProfileId,
    });
    setNewProfileName('');
    setStatus(`已创建配置档：${created ? created.name : profileName}`);
  }

  function onDeleteCurrentCustomProfile() {
    if (
      !working ||
      BUILTIN_PROFILE_IDS.includes(working.activeProfileId as (typeof BUILTIN_PROFILE_IDS)[number])
    )
      return;
    const before = cloneSettingsV3(working);
    setWorkingDirect(removeCustomProfile(working, String(working.activeProfileId)));
    registerHighRiskUndo(before, '已删除当前自定义配置档');
  }

  function onRenameActiveCustomProfile(value: string) {
    if (!working) return;
    const profileId = String(working.activeProfileId);
    if (BUILTIN_PROFILE_IDS.includes(profileId as (typeof BUILTIN_PROFILE_IDS)[number])) return;
    updateWorking((draft) => {
      draft.profilesCustom = draft.profilesCustom.map((item) =>
        item.id === profileId ? { ...item, name: value || item.name, updatedAt: Date.now() } : item
      );
      return draft;
    });
  }

  function onAddSiteRule() {
    if (!working) return;
    const hostname = normalizeHostname(newSite);
    if (!hostname) {
      setStatus('站点格式无效，请输入例如 example.com。');
      return;
    }
    updateWorking((draft) => {
      draft.globalControls.siteRules = setExactDomainRuleEnabled(
        draft.globalControls.siteRules,
        hostname,
        true
      );
      return draft;
    });
    setNewSite('');
    setStatus(`已添加站点规则：${hostname}`);
  }

  function onDeleteSiteRule(hostname: string) {
    if (!working) return;
    const before = cloneSettingsV3(working);
    const nextRules = { ...working.globalControls.siteRules };
    delete nextRules[hostname];
    setWorkingDirect({
      ...working,
      globalControls: {
        ...working.globalControls,
        siteRules: normalizeDomainRules(nextRules),
      },
    });
    registerHighRiskUndo(before, `已删除站点规则：${hostname}`);
  }

  async function onSave() {
    const saveResult = await save('配置已保存并应用到扩展。');
    if (!saveResult) return;
    clearUndo();
    await refreshAfterSave();
    const hint = adaptiveState ? adaptiveState.hint : '';
    setStatus(
      saveResult.preservedLocalEdits
        ? `最近一次保存已完成，当前仍有未保存修改。${hint}`
        : `配置已保存并应用到扩展。${hint}`
    );
  }

  function onReset() {
    reset('已撤销未保存修改。');
    clearUndo();
  }

  function onExportSettings() {
    if (!working) {
      setStatus('当前配置尚未加载完成，暂时无法导出。');
      return;
    }
    try {
      downloadTextFile(
        `${JSON.stringify(cloneSettingsV3(working), null, 2)}\n`,
        `bsv-settings-${new Date().toISOString().slice(0, 10)}.json`,
        'application/json'
      );
      setStatus('当前配置已导出。');
    } catch {
      setStatus('导出配置失败，请重试。');
    }
  }

  function onTriggerImportSettings() {
    if (!saving && !maintenanceBusy) {
      importSettingsInputRef.current?.click();
    }
  }

  async function onImportSettingsFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    setMaintenanceBusy('import');
    try {
      const importedSettings = parseImportedSettingsText(await file.text());
      setWorkingDirect(importedSettings);
      const saveResult = await save('设置导入并应用到扩展。');
      if (!saveResult) {
        setStatus('配置已导入当前编辑稿，但保存失败，请重试。');
      }
      clearUndo();
    } catch {
      setStatus('导入失败，请检查 JSON 格式或配置内容。');
    } finally {
      setMaintenanceBusy(null);
    }
  }

  async function onResetToDefaults() {
    if (saving || maintenanceBusy) return;
    const confirmed = await requestConfirm(
      '恢复默认设置',
      '确定要恢复默认设置吗？所有自定义配置将会丢失。'
    );
    if (!confirmed) return;
    setMaintenanceBusy('reset');
    try {
      const defaults = createResetSettingsSnapshot();
      setWorkingDirect(defaults);
      const saveResult = await save('已恢复默认设置。');
      if (!saveResult) {
        setStatus('默认配置已应用到当前编辑稿，但保存失败，请重试。');
      }
      clearUndo();
    } finally {
      setMaintenanceBusy(null);
    }
  }

  async function onClearVocabularyBook() {
    if (saving || maintenanceBusy) return;
    const confirmed = await requestConfirm(
      '清空已收藏生词',
      '确定要清空所有已收藏的单词吗？此操作不可恢复。'
    );
    if (!confirmed) return;
    setMaintenanceBusy('clear');
    try {
      const clearedCount = await clearVocabularyBook();
      setStatus(
        clearedCount > 0
          ? `已清空 ${clearedCount} 个已收藏单词。`
          : '当前没有已收藏单词，无需清空。'
      );
    } catch {
      setStatus('清空已收藏生词失败，请重试。');
    } finally {
      setMaintenanceBusy(null);
    }
  }

  if (!working || !activeProfile) {
    const isError = !loading && feedback?.stage === 'error';
    const statusMessage = `${status}${statusCode ? `（${statusCode}）` : ''}`;
    return (
      <main className="studio-shell">
        {loading ? (
          <LoadingPanel message={statusMessage} />
        ) : (
          <section className="studio-hero stagger-enter">
            <span className="studio-eyebrow">Bilibili Subtitle Vocabulary</span>
            <h1 className="studio-title">设置加载失败</h1>
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

  const currentSection = SECTION_META.find((item) => item.id === section) || SECTION_META[0];

  return (
    <>
      <main className="settings-shell">
        <aside className="settings-sidebar stagger-enter">
          <div className="settings-brand">
            <span className="popup-brand__mark">SV</span>
            <div>
              <h1>字幕学习设置</h1>
              <p>按任务分类管理扩展行为。</p>
            </div>
          </div>
          <nav className="settings-nav" role="tablist" aria-label="设置分类">
            {SECTION_META.map((item) => (
              <button
                key={item.id}
                type="button"
                className="settings-nav__item"
                role="tab"
                aria-selected={section === item.id}
                aria-controls={`settings-panel-${item.id}`}
                id={`settings-tab-${item.id}`}
                onClick={() => {
                  setSection(item.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <span className="settings-nav__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <strong>{item.name}</strong>
              </button>
            ))}
          </nav>
        </aside>

        <section className="settings-main">
          <header className="settings-toolbar">
            <div>
              <span className="studio-eyebrow">{currentSection.name}</span>
              <h2>{currentSection.description}</h2>
              <p>
                当前配置档：{activeProfileName} · {dirty ? '有未保存修改' : '已同步'}
              </p>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={onReset}
                disabled={!dirty || saving}
              >
                <UndoIcon size={14} />
                撤销修改
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={onSave}
                disabled={!dirty || saving}
                aria-busy={saving}
                data-dirty={dirty || undefined}
              >
                <SaveIcon size={14} />
                {saving ? '保存中...' : '保存更改'}
              </button>
            </div>
          </header>

          <section
            className="save-bar stagger-enter"
            aria-live={feedback && feedback.stage === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            <p className="save-meta">
              <strong>状态：</strong>
              {status}
              {statusCode ? `（${statusCode}）` : ''}
              {feedback && feedback.suggestion ? ` · 建议：${feedback.suggestion}` : ''}
            </p>
          </section>

          <OnboardingPanel
            state={onboardingState}
            busyGoal={onboardingBusy}
            onSelectGoal={(goal) =>
              void completeOnboardingFlow(goal, working ?? undefined, save, setWorkingDirect)
            }
            onDismiss={() => void completeOnboardingFlow(null)}
          />

          {conflict && (
            <section className="save-bar">
              <p className="save-meta">
                <strong>检测到并发修改：</strong>
                冲突范围：{conflict.summary}。
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => resolveConflictUseRemote()}
                  disabled={saving}
                >
                  应用远端版本
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => void resolveConflictUseLocal()}
                  disabled={saving || !dirty}
                >
                  应用本地版本
                </button>
              </div>
            </section>
          )}

          {pendingUndo && (
            <UndoBar
              pendingUndo={pendingUndo}
              onUndo={() => void undoAction(setWorkingDirect, save, setStatus)}
            />
          )}

          <section
            className="settings-content"
            role="tabpanel"
            id={`settings-panel-${section}`}
            aria-labelledby={`settings-tab-${section}`}
          >
            {section === 'basic' && (
              <BasicSettingsSection
                working={working}
                activeProfile={activeProfile}
                activeProfileName={activeProfileName}
                isBuiltinActive={isBuiltinActive}
                profileOptions={profileOptions}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                adaptiveState={adaptiveState}
                learningStreak={learningStreak}
                runtimePreview={runtimePreview}
                updateWorking={updateWorking}
                patchActiveProfile={patchActiveProfile}
                setGlobalControls={setGlobalControls}
                onAddCustomProfile={onAddCustomProfile}
                onDeleteCurrentCustomProfile={onDeleteCurrentCustomProfile}
                onRenameActiveCustomProfile={onRenameActiveCustomProfile}
                onToggleAdaptive={onToggleAdaptive}
              />
            )}
            {section === 'learning' && (
              <LearningStrategySection
                activeProfile={activeProfile}
                activeProfileName={activeProfileName}
                activePresetKey={activePresetKey}
                adaptiveState={adaptiveState}
                experienceMetrics={experienceMetrics}
                patchActiveProfile={patchActiveProfile}
                applyScenePreset={applyScenePreset}
                onLevelToggle={onLevelToggle}
              />
            )}
            {section === 'sites' && (
              <SitesManagementSection
                working={working}
                siteRules={siteRules}
                newSite={newSite}
                setNewSite={setNewSite}
                updateWorking={updateWorking}
                onAddSiteRule={onAddSiteRule}
                onDeleteSiteRule={onDeleteSiteRule}
              />
            )}
            {section === 'display' && (
              <DisplaySection
                working={working}
                activeProfile={activeProfile}
                patchActiveProfile={patchActiveProfile}
                setGlobalControls={setGlobalControls}
              />
            )}
            {section === 'sync' && <SyncSection />}
            {section === 'data' && (
              <DataBackupSection
                saving={saving}
                maintenanceBusy={maintenanceBusy}
                onExportSettings={onExportSettings}
                onTriggerImportSettings={onTriggerImportSettings}
                onResetToDefaults={onResetToDefaults}
                onClearVocabularyBook={onClearVocabularyBook}
                importSettingsInputRef={importSettingsInputRef}
                onImportSettingsFileChange={onImportSettingsFileChange}
              />
            )}
          </section>
        </section>
      </main>

      {confirm.open && (
        <div
          className="confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
        >
          <div className="confirm-dialog">
            <h3 id="confirm-title">{confirm.title}</h3>
            <p>{confirm.message}</p>
            <div className="btn-row">
              <button type="button" className="btn ghost" onClick={() => closeConfirm(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => closeConfirm(true)}
                autoFocus
              >
                确认执行
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function UndoBar({
  pendingUndo,
  onUndo,
}: {
  pendingUndo: { label: string; expiresAt: number };
  onUndo: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    const update = () => setRemainingMs(Math.max(0, pendingUndo.expiresAt - Date.now()));
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [pendingUndo]);

  const progress = remainingMs > 0 ? remainingMs / 6000 : 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <section className="save-bar">
      <p className="save-meta">
        <strong>高风险操作：</strong>
        {pendingUndo.label}。{secondsLeft} 秒内可撤销。
      </p>
      <button type="button" className="btn ghost" onClick={onUndo}>
        撤销该操作
      </button>
      <div className="undo-progress" role="timer" aria-label="撤销倒计时">
        <span className="undo-progress__bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </section>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root for options app');
}
createRoot(rootElement).render(<OptionsApp />);
