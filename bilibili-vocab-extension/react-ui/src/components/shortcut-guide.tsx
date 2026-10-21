import { useEffect, useState } from 'react';

const EMPTY_SHORTCUT_LABEL = '未分配';
const SHORTCUT_TOKEN_LABELS: Record<string, string> = {
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

const SHORTCUTS = [
  {
    id: 'toggle-enabled',
    label: '切换字幕替换',
    defaultKeys: 'Ctrl+Shift+E',
    description: '快速开关字幕替换，不必打开 Popup。',
  },
  {
    id: 'toggle-overlay',
    label: '切换悬浮面板',
    defaultKeys: 'Ctrl+Shift+O',
    description: '随时呼出或收起 Overlay 学习面板。',
  },
  {
    id: 'increase-ratio',
    label: '提高替换比例',
    defaultKeys: 'Ctrl+Shift+Up',
    description: '在当前视频页直接提升单句词汇曝光强度。',
  },
  {
    id: 'decrease-ratio',
    label: '降低替换比例',
    defaultKeys: 'Ctrl+Shift+Down',
    description: '在阅读压力过高时即时降低曝光强度。',
  },
] as const;

type ShortcutGuideSource = 'loading' | 'live' | 'fallback';

interface ShortcutGuideItem {
  id: (typeof SHORTCUTS)[number]['id'];
  label: string;
  description: string;
  keys: string;
  note: string;
  unassigned: boolean;
}

interface ShortcutGuideState {
  source: ShortcutGuideSource;
  items: ShortcutGuideItem[];
  unassignedCount: number;
}

function formatShortcutKeys(shortcut: string): string {
  return String(shortcut || '')
    .split('+')
    .map((token) => {
      const normalized = token.trim();
      return SHORTCUT_TOKEN_LABELS[normalized] || normalized;
    })
    .join('+');
}

function buildLoadingShortcutGuideState(): ShortcutGuideState {
  return {
    source: 'loading',
    unassignedCount: 0,
    items: SHORTCUTS.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      keys: formatShortcutKeys(item.defaultKeys),
      note: `推荐默认值：${formatShortcutKeys(item.defaultKeys)}`,
      unassigned: false,
    })),
  };
}

function buildFallbackShortcutGuideState(): ShortcutGuideState {
  return {
    source: 'fallback',
    unassignedCount: 0,
    items: SHORTCUTS.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      keys: formatShortcutKeys(item.defaultKeys),
      note: `推荐默认值：${formatShortcutKeys(item.defaultKeys)}`,
      unassigned: false,
    })),
  };
}

function buildLiveShortcutGuideState(commands: chrome.commands.Command[]): ShortcutGuideState {
  const commandMap = new Map<string, chrome.commands.Command>();
  commands.forEach((command) => {
    const commandName = String(command.name || '').trim();
    if (commandName) {
      commandMap.set(commandName, command);
    }
  });

  let unassignedCount = 0;
  const items = SHORTCUTS.map((item) => {
    const matchedCommand = commandMap.get(item.id);
    const shortcut = String(
      matchedCommand && matchedCommand.shortcut ? matchedCommand.shortcut : ''
    ).trim();
    const unassigned = shortcut.length === 0;

    if (unassigned) {
      unassignedCount += 1;
    }

    return {
      id: item.id,
      label: item.label,
      description: item.description,
      keys: unassigned ? EMPTY_SHORTCUT_LABEL : formatShortcutKeys(shortcut),
      note: unassigned ? `推荐默认值：${formatShortcutKeys(item.defaultKeys)}` : '',
      unassigned,
    };
  });

  return {
    source: 'live',
    items,
    unassignedCount,
  };
}

function getGuideBadge(state: ShortcutGuideState): { label: string; tone: '' | 'good' | 'warn' } {
  if (state.source === 'loading') {
    return { label: '读取浏览器绑定中', tone: '' };
  }
  if (state.source === 'live' && state.unassignedCount > 0) {
    return { label: `${state.unassignedCount} 个未分配`, tone: 'warn' };
  }
  if (state.source === 'live') {
    return { label: '已读取浏览器绑定', tone: 'good' };
  }
  return { label: '显示推荐默认值', tone: '' };
}

function getGuideNote(state: ShortcutGuideState): string {
  if (state.source === 'loading') {
    return '正在读取浏览器当前已生效的命令绑定；若当前环境不支持，会回退显示推荐默认值。';
  }
  if (state.source === 'live' && state.unassignedCount > 0) {
    return `检测到 ${state.unassignedCount} 个命令未分配。请到 chrome://extensions/shortcuts 补齐绑定，否则对应快捷操作不会生效。macOS 使用 Command 替代 Ctrl。`;
  }
  if (state.source === 'live') {
    return '这里显示的是浏览器当前已生效的命令绑定。macOS 使用 Command 替代 Ctrl，快捷键仍可在 chrome://extensions/shortcuts 自定义。';
  }
  return '当前环境无法读取浏览器绑定，以下显示推荐默认值。macOS 使用 Command 替代 Ctrl，快捷键可在 chrome://extensions/shortcuts 自定义。';
}

export function ShortcutGuide({
  title = '快捷操作',
  compact = false,
}: {
  title?: string;
  compact?: boolean;
}) {
  const [guideState, setGuideState] = useState<ShortcutGuideState>(() =>
    buildLoadingShortcutGuideState()
  );

  useEffect(() => {
    let cancelled = false;

    if (
      typeof chrome === 'undefined' ||
      !chrome.commands ||
      typeof chrome.commands.getAll !== 'function'
    ) {
      setGuideState(buildFallbackShortcutGuideState());
      return () => {
        cancelled = true;
      };
    }

    try {
      chrome.commands.getAll((commands) => {
        if (cancelled) {
          return;
        }

        if (chrome.runtime && chrome.runtime.lastError) {
          setGuideState(buildFallbackShortcutGuideState());
          return;
        }

        setGuideState(buildLiveShortcutGuideState(commands || []));
      });
    } catch {
      setGuideState(buildFallbackShortcutGuideState());
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const badge = getGuideBadge(guideState);

  return (
    <section className="shortcut-guide stack">
      <div className="inline">
        <h3>{title}</h3>
        <span className={`badge${badge.tone ? ` ${badge.tone}` : ''}`}>{badge.label}</span>
      </div>
      <div className={`shortcut-guide__list${compact ? ' shortcut-guide__list--compact' : ''}`}>
        {guideState.items.map((item) => (
          <div className="shortcut-guide__item" key={item.id}>
            <div className="shortcut-guide__content">
              <strong>{item.label}</strong>
              <span>{item.description}</span>
              {item.note && <span className="shortcut-guide__hint">{item.note}</span>}
            </div>
            <kbd data-unassigned={item.unassigned ? 'true' : 'false'}>{item.keys}</kbd>
          </div>
        ))}
      </div>
      <p className="shortcut-guide__note">{getGuideNote(guideState)}</p>
    </section>
  );
}
