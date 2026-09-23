import { describe, expect, it } from "vitest";
import { deriveSignalEvidence } from "../../src/analysis/evidence.js";
import { groupedTemporalSplit } from "../../src/analysis/split.js";
import { loadCase } from "../../src/case/load-case.js";
import {
  assertSyntheticQualityGates,
  calculateHoldoutMetrics,
} from "../../src/evaluation/metrics.js";
import { scorePolicy } from "../../src/evaluation/score-policy.js";
import { buildPolicyManifest } from "../../src/policy/manifest.js";
import { selectPolicy } from "../../src/policy/select-policy.js";

function pipeline() {
  const loaded = loadCase("fixtures/building-materials-distributor");
  const split = groupedTemporalSplit(loaded.ingestion.deals, {
    holdoutFraction: loaded.brief.analysis.holdout_fraction,
    minimumTrainingClassCount: loaded.brief.analysis.minimum_class_count,
    minimumHoldoutClassCount: loaded.brief.analysis.minimum_holdout_class_count,
  });
  const evidence = deriveSignalEvidence(split.trainingDeals, loaded.brief.candidate_signals, {
    bootstrapSeed: loaded.brief.analysis.bootstrap_seed,
    bootstrapSamples: loaded.brief.analysis.bootstrap_samples,
    minimumLabeledDeals: loaded.brief.analysis.minimum_labeled_deals,
    minimumClassCount: loaded.brief.analysis.minimum_class_count,
    prohibitedColumns: loaded.brief.prohibited_columns,
  });
  const selection = selectPolicy({
    brief: loaded.brief,
    state: loaded.state,
    evidence,
    deals: loaded.ingestion.deals,
  });
  const manifest = buildPolicyManifest({
    brief: loaded.brief,
    state: loaded.state,
    deals: loaded.ingestion.deals,
    prospects: loaded.ingestion.prospects,
    split,
    evidence,
    selection,
  });
  const scoredHoldout = scorePolicy(split.holdoutDeals, loaded.brief, manifest);
  const evaluation = calculateHoldoutMetrics(scoredHoldout, loaded.brief);
  return { loaded, evidence, manifest, evaluation };
}

describe("synthetic expected policy contract", () => {
  it("passes every semantic policy and quality expectation", () => {
    const { loaded, evidence, manifest, evaluation } = pipeline();
    expect(() =>
      assertSyntheticQualityGates({
        manifest,
        evidence,
        evaluation,
        expected: loaded.expectedPolicy,
      }),
    ).not.toThrow();
    expect(evaluation.policy_coverage).toBeGreaterThanOrEqual(0.8);
    expect(evaluation.top_bucket_lift_pp).toBeGreaterThanOrEqual(15);
    expect(evaluation.unacknowledged_vetoed_win_ids).toHaveLength(0);
  });

  it("ranks the strong prospect first and the inactive strong-fit prospect last", () => {
    const { loaded, manifest } = pipeline();
    const preview = scorePolicy(loaded.ingestion.prospects, loaded.brief, manifest);
    expect(preview[0]?.source_record_id).toBe("P-STRONG");
    expect(preview.at(-1)?.source_record_id).toBe("P-INACTIVE");
    expect(preview.at(-1)?.vetoed).toBe(true);
  });
});
