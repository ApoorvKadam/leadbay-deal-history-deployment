import type { CandidateEvidence } from "../analysis/evidence.js";
import type { CustomerBrief, ExpectedPolicy, PolicyManifest } from "../case/schema.js";
import { AppError } from "../shared/errors.js";
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

function sameStrings(actual: string[], expected: string[]): boolean {
  return [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000");
}

export interface SyntheticQualityGateInput {
  manifest: PolicyManifest;
  evidence: CandidateEvidence[];
  evaluation: HoldoutEvaluation;
  expected: ExpectedPolicy;
}

export function assertSyntheticQualityGates(input: SyntheticQualityGateInput): void {
  const failures: string[] = [];
  const selectedIds = input.manifest.question_additions.map((item) => item.candidate_id);
  if (!sameStrings(selectedIds, input.expected.selected_candidate_ids)) {
    failures.push(
      `Selected candidate IDs differ: expected ${input.expected.selected_candidate_ids.join(", ")}; got ${selectedIds.join(", ")}.`,
    );
  }
  for (const [candidateId, expectedText] of Object.entries(input.expected.exact_questions)) {
    const actual = input.manifest.question_additions.find(
      (item) => item.candidate_id === candidateId,
    )?.text;
    if (actual !== expectedText) {
      failures.push(`Question text for ${candidateId} differs from the independent expectation.`);
    }
  }
  const antiPatternIds = input.manifest.anti_pattern_additions.map((item) => item.veto_id);
  if (!sameStrings(antiPatternIds, input.expected.anti_pattern_ids)) {
    failures.push(
      `Anti-pattern IDs differ: expected ${input.expected.anti_pattern_ids.join(", ")}; got ${antiPatternIds.join(", ")}.`,
    );
  }
  const evidenceById = new Map(
    input.evidence.map((item) => [item.candidateId, item.classification]),
  );
  for (const [candidateId, expectedClassification] of Object.entries(
    input.expected.rejected_candidates,
  )) {
    const actual = evidenceById.get(candidateId);
    if (actual !== expectedClassification) {
      failures.push(
        `Evidence classification for ${candidateId} differs: expected ${expectedClassification}; got ${actual ?? "missing"}.`,
      );
    }
  }
  if (input.evaluation.policy_coverage < input.expected.minimum_policy_coverage) {
    failures.push(
      `Policy coverage ${input.evaluation.policy_coverage} is below ${input.expected.minimum_policy_coverage}.`,
    );
  }
  if (input.evaluation.top_bucket_lift_pp < input.expected.minimum_top_bucket_lift_pp) {
    failures.push(
      `Top-bucket lift ${input.evaluation.top_bucket_lift_pp}pp is below ${input.expected.minimum_top_bucket_lift_pp}pp.`,
    );
  }
  if (
    input.evaluation.unacknowledged_vetoed_win_ids.length >
    input.expected.maximum_unacknowledged_vetoed_wins
  ) {
    failures.push(
      `Unacknowledged vetoed wins ${input.evaluation.unacknowledged_vetoed_win_ids.length} exceed ${input.expected.maximum_unacknowledged_vetoed_wins}.`,
    );
  }
  if (failures.length > 0) {
    throw new AppError({
      code: "SYNTHETIC_QUALITY_GATE_FAILED",
      exitCode: 3,
      message: "The synthetic deployment case failed its independent quality contract.",
      hint: "Inspect the evaluation diagnostics; do not preview a deployment until the evidence contract passes.",
      details: { failures, evaluation: input.evaluation },
    });
  }
}
