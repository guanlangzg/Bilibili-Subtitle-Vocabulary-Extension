import { useEffect, useMemo, useRef, useState } from 'react';
import {
  readQuickReviewDashboard,
  subscribeQuickReviewSource,
  submitQuickReviewFeedback,
  readEncounteredWordRanking,
  LearningSummary,
  QuickReviewDashboard,
} from '../lib/learning-client';
import {
  QuickReviewAction,
  EncounteredWordRankingItem,
  EncounteredWordSortMode,
  buildQuickReviewCard,
  QuickReviewCardState,
} from '../lib/learning-dashboard';

const EMPTY_SUMMARY: LearningSummary = {
  todayCount: 0,
  newCount: 0,
  masteredCount: 0,
  recentWords: [],
};

const EMPTY_REVIEW_DASHBOARD: QuickReviewDashboard = {
  summary: EMPTY_SUMMARY,
  items: [],
};

export function useQuickReview(setStatus: (status: string) => void): {
  summary: LearningSummary;
  quickReview: QuickReviewDashboard;
  reviewCursor: number;
  reviewSubmitting: QuickReviewAction | null;
  quickReviewCard: QuickReviewCardState;
  encounteredRanking: EncounteredWordRankingItem[];
  rankingSortMode: EncounteredWordSortMode;
  setRankingSortMode: (mode: EncounteredWordSortMode) => void;
  cycleQuickReviewCard: () => void;
  handleQuickReviewAction: (action: QuickReviewAction) => Promise<void>;
  refreshRanking: () => Promise<void>;
} {
  const [summary, setSummary] = useState<LearningSummary>(EMPTY_SUMMARY);
  const [quickReview, setQuickReview] = useState<QuickReviewDashboard>(EMPTY_REVIEW_DASHBOARD);
  const [reviewCursor, setReviewCursor] = useState(0);
  const [reviewSubmitting, setReviewSubmitting] = useState<QuickReviewAction | null>(null);
  const [encounteredRanking, setEncounteredRanking] = useState<EncounteredWordRankingItem[]>([]);
  const [rankingSortMode, setRankingSortMode] = useState<EncounteredWordSortMode>('asc');
  // Ranking loads in its own effect; the shared subscription refreshes it
  // through this handle so storage.onChanged is registered once.
  const reloadRankingRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    const loadDashboard = (failureMessage: string) => {
      void readQuickReviewDashboard()
        .then((next) => {
          if (cancelled) return;
          setQuickReview(next);
          setSummary(next.summary);
        })
        .catch(() => {
          if (!cancelled) setStatus(failureMessage);
        });
    };
    loadDashboard('学习概览读取失败，请稍后重试。');

    const unsubscribe = subscribeQuickReviewSource(() => {
      loadDashboard('学习数据读取失败，请稍后重试。');
      reloadRankingRef.current();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setStatus]);

  useEffect(() => {
    if (!quickReview.items.length) {
      setReviewCursor(0);
      return;
    }
    setReviewCursor((current) => (current >= quickReview.items.length ? 0 : current));
  }, [quickReview.items]);

  useEffect(() => {
    let cancelled = false;
    const loadRanking = () => {
      void readEncounteredWordRanking(rankingSortMode, 6)
        .then((items) => {
          if (!cancelled) setEncounteredRanking(items);
        })
        .catch(() => {
          if (!cancelled) setStatus('生词排行读取失败，请稍后重试。');
        });
    };
    reloadRankingRef.current = loadRanking;
    loadRanking();

    return () => {
      cancelled = true;
      reloadRankingRef.current = () => {};
    };
  }, [rankingSortMode, setStatus]);

  const quickReviewCard = useMemo(
    () => buildQuickReviewCard(quickReview.items, reviewCursor),
    [quickReview.items, reviewCursor]
  );

  function cycleQuickReviewCard() {
    if (quickReview.items.length <= 1) return;
    setReviewCursor((current) => (current + 1) % quickReview.items.length);
  }

  async function handleQuickReviewAction(action: QuickReviewAction) {
    if (!quickReviewCard.currentItem || reviewSubmitting) return;
    const currentWord = quickReviewCard.currentItem.word;
    setReviewSubmitting(action);
    try {
      const result = await submitQuickReviewFeedback(currentWord, action);
      setQuickReview({ summary: result.summary, items: result.items });
      setSummary(result.summary);
      setReviewCursor(0);
      const nextRanking = await readEncounteredWordRanking(rankingSortMode, 6).catch(() => null);
      if (nextRanking) setEncounteredRanking(nextRanking);
      const actionText =
        action === 'know' ? '已标记为认识' : action === 'fuzzy' ? '已标记为模糊' : '已标记为不认识';
      setStatus(result.adaptiveApplied ? `${actionText}，并已触发自动调优。` : actionText);
    } catch {
      setStatus('快速复习保存失败，请重试。');
    } finally {
      setReviewSubmitting(null);
    }
  }

  async function refreshRanking() {
    try {
      const items = await readEncounteredWordRanking(rankingSortMode, 6);
      setEncounteredRanking(items);
    } catch {
      setStatus('生词排行读取失败，请稍后重试。');
    }
  }

  return {
    summary,
    quickReview,
    reviewCursor,
    reviewSubmitting,
    quickReviewCard,
    encounteredRanking,
    rankingSortMode,
    setRankingSortMode,
    cycleQuickReviewCard,
    handleQuickReviewAction,
    refreshRanking,
  };
}
