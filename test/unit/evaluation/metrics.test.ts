import { describe, expect, it } from "vitest";
import type { CustomerBrief, PolicyManifest } from "../../../src/case/schema.js";
import { calculateHoldoutMetrics } from "../../../src/evaluation/metrics.js";
import type { ScoredRecord } from "../../../src/evaluation/score-policy.js";
import { AppError } from "../../../src/shared/errors.js";
import { type ExpectedPolicy, assertSyntheticQualityGates } from "../../helpers/expected-policy.js";

function row(
  id: string,
  outcome: "positive" | "negative",
  known: number,
  vetoMatches: string[] = [],
): ScoredRecord {
  return {
    rank: Number(id.slice(1)),
    source_record_id: id,
    company_name: id,
    outcome,
    local_policy_score: known,
    known_signal_count: known,
    unknown_signal_count: known === 0 ? 1 : 0,
    signal_states: { q: known === 0 ? "unknown" : true },
    vetoed: vetoMatches.length > 0,
    veto_matches: vetoMatches,
    veto_unknown_count: 0,
  };
}

const scored = [
  row("R1", "positive", 1),
  row("R2", "positive", 1),
  row("R3", "negative", 1),
  row("R4", "positive", 1),
  row("R5", "negative", 1),
  row("R6", "negative", 1),
  row("R7", "positive", 1, ["inactive_company"]),
  row("R8", "negative", 0),
];

const brief = {
  explicit_vetoes: [
    {
      id: "inactive_company",
      historical_win_tradeoff_acknowledged: false,
    },
  ],
} as unknown as CustomerBrief;

describe("calculateHoldoutMetrics", () => {
  it("calculates the documented top bucket, lift, coverage, and error cohorts", () => {
    const result = calculateHoldoutMetrics(scored, brief);
    expect(result.holdout_rows).toBe(8);
    expect(result.top_bucket_size).toBe(5);
    expect(result.baseline_win_rate).toBe(0.5);
    expect(result.top_bucket_win_rate).toBe(0.6);
    expect(result.top_bucket_lift_pp).toBe(10);
    expect(result.wins_captured_in_top_half).toBe(3);
    expect(result.total_wins).toBe(4);
    expect(result.policy_coverage).toBe(0.875);
    expect(result.false_positive_ids).toEqual(["R3", "R5"]);
    expect(result.false_negative_ids).toEqual(["R7"]);
    expect(result.vetoed_historical_win_ids).toEqual(["R7"]);
    expect(result.unacknowledged_vetoed_win_ids).toEqual(["R7"]);
    expect(result.per_question.q).toEqual({ known: 7, true: 7, false: 0, missing: 1 });
  });
});

describe("assertSyntheticQualityGates", () => {
  it("fails with exit code 3 and preserves the evaluation diagnostics", () => {
    const evaluation = calculateHoldoutMetrics(scored, brief);
    const manifest = {
      question_additions: [],
      anti_pattern_additions: [],
    } as unknown as PolicyManifest;
    const expected = {
      selected_candidate_ids: [],
      exact_questions: {},
      anti_pattern_ids: [],
      rejected_candidates: {},
      minimum_policy_coverage: 0.9,
      minimum_top_bucket_lift_pp: 15,
      maximum_unacknowledged_vetoed_wins: 0,
    } as unknown as ExpectedPolicy;
    let error: unknown;
    try {
      assertSyntheticQualityGates({ manifest, evidence: [], evaluation, expected });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof AppError).toBe(true);
    expect((error as AppError).exitCode).toBe(3);
    expect((error as AppError).code).toBe("SYNTHETIC_QUALITY_GATE_FAILED");
    expect((error as AppError).details).toMatchObject({ evaluation });
  });
});
