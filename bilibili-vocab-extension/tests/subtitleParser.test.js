const test = require('node:test');
const assert = require('node:assert/strict');

const subtitleParser = require('../subtitleParser.js');

test('host detection: 应识别 Bilibili 与 YouTube 域名', () => {
  assert.equal(subtitleParser.isBilibiliHost('www.bilibili.com'), true);
  assert.equal(subtitleParser.isBilibiliHost('www.youtube.com'), false);
  assert.equal(subtitleParser.isYouTubeHost('www.youtube.com'), true);
  assert.equal(subtitleParser.isYouTubeHost('music.youtube.com'), true);
  assert.equal(subtitleParser.isYouTubeHost('www.bilibili.com'), false);
});

test('normalizeSubtitleUrl: 应将协议相对地址补全为 https', () => {
  const normalized = subtitleParser.normalizeSubtitleUrl(
    '//aisubtitle.hdslb.com/bfs/subtitle/demo.json'
  );
  assert.equal(normalized, 'https://aisubtitle.hdslb.com/bfs/subtitle/demo.json');
});

test('normalizeSubtitleUrl: 应拒绝非 HTTPS 或非官方字幕域名', () => {
  assert.equal(subtitleParser.normalizeSubtitleUrl('http://aisubtitle.hdslb.com/demo.json'), '');
  assert.equal(subtitleParser.normalizeSubtitleUrl('https://example.com/demo.json'), '');
  assert.equal(
    subtitleParser.normalizeSubtitleUrl('https://aisubtitle.hdslb.com.evil/demo.json'),
    ''
  );
});

test('pickPreferredSubtitleTrack: 应优先选择简体中文字幕轨道', () => {
  const selected = subtitleParser.pickPreferredSubtitleTrack([
    { lan: 'en-US', subtitle_url: 'https://example.com/en.json' },
    { lan: 'zh-Hans', subtitle_url: 'https://example.com/zh-hans.json' },
    { lan: 'zh-CN', subtitle_url: 'https://example.com/zh-cn.json' },
  ]);

  assert.ok(selected);
  assert.equal(selected.lan, 'zh-Hans');
});

test('findSubtitleByTime: 应按视频时间命中正确字幕分段', () => {
  const body = [
    { from: 0, to: 1.9, content: '第一句' },
    { from: 2.0, to: 4.5, content: '第二句' },
  ];

  const matched = subtitleParser.findSubtitleByTime(body, 3.2);
  assert.ok(matched);
  assert.equal(matched.content, '第二句');
});

function createNode(parent = null) {
  return {
    parent,
    contains(target) {
      let cursor = target;
      while (cursor) {
        if (cursor === this) {
          return true;
        }
        cursor = cursor.parent || null;
      }
      return false;
    },
  };
}

test('addElementByContainment: child should replace its collected parent', () => {
  const parent = createNode();
  const child = createNode(parent);
  const collected = [parent];

  const added = subtitleParser.addElementByContainment(child, collected);

  assert.equal(added, true);
  assert.deepEqual(collected, [child]);
});

test('addElementByContainment: parent should not be added when its child is already collected', () => {
  const parent = createNode();
  const child = createNode(parent);
  const collected = [child];

  const added = subtitleParser.addElementByContainment(parent, collected);

  assert.equal(added, false);
  assert.deepEqual(collected, [child]);
});

test('pickPreferredSubtitleTrack: 中文轨道（含 AI 字幕与繁体）应优先于外语轨道', () => {
  const cases = [
    { lans: ['en-US', 'ai-zh'], expected: 'ai-zh' },
    { lans: ['en-US', 'zh-Hant'], expected: 'zh-Hant' },
    { lans: ['en', 'zh-TW'], expected: 'zh-TW' },
    { lans: ['zh-Hans', 'zh-CN', 'zh-Hant'], expected: 'zh-Hans' },
  ];

  cases.forEach(({ lans, expected }) => {
    const selected = subtitleParser.pickPreferredSubtitleTrack(
      lans.map((lan, index) => ({ lan, subtitle_url: `https://example.com/${index}.json` }))
    );
    assert.ok(selected, `expected a track for ${lans.join(',')}`);
    assert.equal(selected.lan, expected);
  });
});

test('pickPreferredSubtitleTrack: 全为外语轨道时应保持原有优先级', () => {
  const selected = subtitleParser.pickPreferredSubtitleTrack([
    { lan: 'fr', subtitle_url: 'https://example.com/fr.json' },
    { lan: 'en', subtitle_url: 'https://example.com/en.json' },
  ]);

  assert.ok(selected);
  assert.equal(selected.lan, 'en');
});
