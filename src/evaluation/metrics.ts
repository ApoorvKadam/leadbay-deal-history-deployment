import type { CustomerBrief } from "../case/schema.js";
import type { ScoredRecord } from "./score-policy.js";

export interface PerQuestionCounts {
  known: number;
  true: number;
  false: number;
  missing: number;
}

export interface HoldoutEvaluation {
  holdout_rows: number;
  baseline_win_rate: number;
  top_bucket_size: number;
  top_bucket_win_rate: number;
  top_bucket_lift_pp: number;
  wins_captured_in_top_half: number;
  total_wins: number;
  top_half_win_capture_rate: number;
  policy_coverage: number;
  false_positive_ids: string[];
  false_negative_ids: string[];
  vetoed_historical_win_ids: string[];
  unacknowledged_vetoed_win_ids: string[];
  per_question: Record<string, PerQuestionCounts>;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function winRate(rows: ScoredRecord[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((row) => row.outcome === "positive").length / rows.length;
}

export function calculateHoldoutMetrics(
  scored: ScoredRecord[],
  brief: CustomerBrief,
): HoldoutEvaluation {
  const holdoutRows = scored.length;
  const totalWins = scored.filter((row) => row.outcome === "positive").length;
  const baselineWinRate = winRate(scored);
  const topBucketSize = Math.min(holdoutRows, Math.max(5, Math.ceil(0.25 * holdoutRows)));
  const topBucket = scored.slice(0, topBucketSize);
  const topBucketWinRate = winRate(topBucket);
  const topHalfSize = Math.ceil(holdoutRows / 2);
  const topHalf = scored.slice(0, topHalfSize);
  const bottomHalf = scored.slice(topHalfSize);
  const winsCapturedInTopHalf = topHalf.filter((row) => row.outcome === "positive").length;
  const acknowledged = new Map(
    brief.explicit_vetoes.map((veto) => [veto.id, veto.historical_win_tradeoff_acknowledged]),
  );
  const vetoedWins = scored.filter((row) => row.outcome === "positive" && row.vetoed);
  const perQuestion: Record<string, PerQuestionCounts> = {};
  for (const row of scored) {
    for (const [candidateId, state] of Object.entries(row.signal_states)) {
      let counts = perQuestion[candidateId];
      if (counts === undefined) {
        counts = { known: 0, true: 0, false: 0, missing: 0 };
        perQuestion[candidateId] = counts;
      }
      if (state === "unknown") counts.missing++;
      else {
        counts.known++;
        if (state === true) counts.true++;
        else counts.false++;
      }
    }
  }

  return {
    holdout_rows: holdoutRows,
    baseline_win_rate: roundMetric(baselineWinRate),
    top_bucket_size: topBucketSize,
    top_bucket_win_rate: roundMetric(topBucketWinRate),
    top_bucket_lift_pp: roundMetric(100 * (topBucketWinRate - baselineWinRate)),
    wins_captured_in_top_half: winsCapturedInTopHalf,
    total_wins: totalWins,
    top_half_win_capture_rate: totalWins === 0 ? 0 : roundMetric(winsCapturedInTopHalf / totalWins),
    policy_coverage:
      holdoutRows === 0
        ? 0
        : roundMetric(scored.filter((row) => row.known_signal_count > 0).length / holdoutRows),
    false_positive_ids: topBucket
      .filter((row) => row.outcome === "negative")
      .map((row) => row.source_record_id),
    false_negative_ids: bottomHalf
      .filter((row) => row.outcome === "positive")
      .map((row) => row.source_record_id),
    vetoed_historical_win_ids: vetoedWins.map((row) => row.source_record_id),
    unacknowledged_vetoed_win_ids: vetoedWins
      .filter((row) => row.veto_matches.some((vetoId) => acknowledged.get(vetoId) !== true))
      .map((row) => row.source_record_id),
    per_question: perQuestion,
  };
}
