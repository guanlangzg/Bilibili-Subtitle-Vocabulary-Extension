import {
  ProfileConfig,
  buildSettingsPreview,
  getBilingualModeLabel,
  getLearningProfile,
  getMockPreviewData,
  getReviewDanmakuDensityLabel,
  getReviewDanmakuSpeedLabel,
} from '../lib/settings-bridge';

interface StudyPreviewProps {
  profile: ProfileConfig;
  title: string;
  subtitle: string;
  sentenceVariant: 'options' | 'popup';
}

interface PreviewToken {
  word: string;
  sourceText: string;
}

function getPreviewTokens(
  words: string[],
  variant: StudyPreviewProps['sentenceVariant']
): PreviewToken[] {
  const sourceWords =
    variant === 'popup' ? ['系统', '听力', '词汇反应速度'] : ['建立', '词汇', '输入节奏'];

  return words.map((word, index) => ({
    word,
    sourceText: sourceWords[index] || '原词',
  }));
}

function renderPreviewWord(token: PreviewToken, showSourceText: boolean) {
  return (
    <span className="preview-word">
      {token.word}
      {showSourceText ? `（${token.sourceText}）` : ''}
    </span>
  );
}

function renderPreviewSentence(
  tokens: PreviewToken[],
  variant: StudyPreviewProps['sentenceVariant'],
  bilingualMode: ProfileConfig['bilingualMode']
) {
  const showSourceText = bilingualMode === 'default';
  const [firstToken, secondToken, thirdToken] = tokens;
  const firstWord = firstToken || { word: 'establish', sourceText: '建立' };
  const secondWord = secondToken || { word: 'vocabulary', sourceText: '词汇' };
  const thirdWord = thirdToken || { word: 'context', sourceText: '输入节奏' };

  if (variant === 'popup') {
    return (
      <>
        预览：我今天想 {renderPreviewWord(firstWord, showSourceText)} 提升英语{' '}
        {renderPreviewWord(secondWord, showSourceText)}
        {thirdToken ? <>，并强化 {renderPreviewWord(thirdWord, showSourceText)}</> : null}。
      </>
    );
  }

  return (
    <>
      预览：这段视频会帮你 {renderPreviewWord(firstWord, showSourceText)} 稳定的{' '}
      {renderPreviewWord(secondWord, showSourceText)} 输入
      {thirdToken ? <>，并保持 {renderPreviewWord(thirdWord, showSourceText)}</> : null}。
    </>
  );
}

export function StudyPreview({ profile, title, subtitle, sentenceVariant }: StudyPreviewProps) {
  const learningProfile = getLearningProfile(profile);
  const previewTokens = getPreviewTokens(
    getMockPreviewData(profile.targetCefr, profile.replaceRatio, profile.maxReplaceCount),
    sentenceVariant
  );
  const summary = buildSettingsPreview(profile);
  const originalSentence =
    sentenceVariant === 'popup'
      ? '我今天想系统提升英语听力和词汇反应速度。'
      : '这段视频会帮你建立稳定的词汇输入节奏。';

  return (
    <div className="study-preview stack">
      <div className="inline">
        <div>
          <h3>{title}</h3>
          <p className="panel-subtitle">{subtitle}</p>
        </div>
        <span className={`badge preview-tone preview-tone--${learningProfile.tone}`}>
          {learningProfile.label}
        </span>
      </div>

      <div className="preview-metrics-grid">
        <div className="preview-metric-card">
          <span>替换比例</span>
          <strong>{Math.round(profile.replaceRatio * 100)}%</strong>
        </div>
        <div className="preview-metric-card">
          <span>单句上限</span>
          <strong>{profile.maxReplaceCount} 词</strong>
        </div>
        <div className="preview-metric-card">
          <span>复习节奏</span>
          <strong>{getReviewDanmakuSpeedLabel(profile.reviewDanmakuSpeed)}</strong>
        </div>
        <div className="preview-metric-card">
          <span>弹幕密度</span>
          <strong>{getReviewDanmakuDensityLabel(profile.reviewDanmakuDensity)}</strong>
        </div>
      </div>

      <div className="summary-item">
        <strong>策略摘要</strong>
        <span>{summary}</span>
      </div>

      <div className="preview-card">
        <div className="preview-card__head">
          <span className="preview-card__label">学习预览</span>
          <span className={`preview-card__tag preview-card__tag--${learningProfile.tone}`}>
            {learningProfile.label}
          </span>
        </div>
        <p className="preview-card__sentence">
          {renderPreviewSentence(previewTokens, sentenceVariant, profile.bilingualMode)}
        </p>
        {profile.bilingualMode === 'bilingual' && (
          <p className="preview-card__translation">原句：{originalSentence}</p>
        )}
        <p className="preview-card__caption">
          {learningProfile.summary} 当前目标难度：{profile.targetCefr} · 显示模式：
          {getBilingualModeLabel(profile.bilingualMode)}。
        </p>
      </div>
    </div>
  );
}
