import { describe, expect, it } from "vitest";
import {
  calculateSmoothedEffect,
  classifyEvidence,
  deriveSignalEvidence,
  sortEligibleEvidence,
} from "../../../src/analysis/evidence.js";
import { groupedTemporalSplit } from "../../../src/analysis/split.js";
import { loadCase } from "../../../src/case/load-case.js";
import type { CandidateSignal } from "../../../src/case/schema.js";

const baseGate = {
  prohibited: false,
  publiclyObservable: true,
  knownCoverage: 1,
  missingnessGapPp: 0,
  trueRows: 20,
  falseRows: 20,
  supportThreshold: 8,
  effectPp: 20,
  directionStability: 0.8,
};

describe("calculateSmoothedEffect", () => {
  it("uses the documented prior-strength-four formula", () => {
    expect(
      calculateSmoothedEffect({
        overallWins: 30,
        overallRows: 60,
        trueWins: 18,
        trueRows: 24,
        falseWins: 12,
        falseRows: 36,
      }),
    ).toEqual({
      pAll: 0.5,
      pTrue: 20 / 28,
      pFalse: 14 / 40,
      effectPp: 100 * (20 / 28 - 14 / 40),
    });
  });
});

describe("classifyEvidence", () => {
  it("uses the fixed gate precedence", () => {
    expect(classifyEvidence({ ...baseGate, prohibited: true })).toBe("prohibited");
    expect(classifyEvidence({ ...baseGate, publiclyObservable: false })).toBe(
      "not_publicly_observable",
    );
    expect(classifyEvidence({ ...baseGate, knownCoverage: 0.64 })).toBe("high_missingness");
    expect(classifyEvidence({ ...baseGate, missingnessGapPp: 20.1 })).toBe(
      "outcome_dependent_missingness",
    );
    expect(classifyEvidence({ ...baseGate, trueRows: 7 })).toBe("low_support");
    expect(classifyEvidence({ ...baseGate, effectPp: -12 })).toBe("contradicted");
    expect(classifyEvidence({ ...baseGate, effectPp: 12, directionStability: 0.69 })).toBe(
      "unstable",
    );
    expect(classifyEvidence(baseGate)).toBe("eligible");
    expect(classifyEvidence({ ...baseGate, effectPp: 11.99 })).toBe("weak_effect");
  });
});

describe("deriveSignalEvidence", () => {
  it("derives the intended semantic classifications from the committed synthetic case", () => {
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
    const classifications = Object.fromEntries(
      evidence.map((item) => [item.candidateId, item.classification]),
    );
    expect(classifications).toMatchObject({
      multi_territory_field_sales: "eligible",
      fragmented_smb_market: "eligible",
      crm_exportability: "eligible",
      enterprise_scale: "contradicted",
      recent_funding: "high_missingness",
      warehouse_density: "unstable",
    });
    expect(evidence.map((item) => item.candidateId)).toEqual(
      [...evidence.map((item) => item.candidateId)].sort(),
    );
    expect(sortEligibleEvidence(evidence).map((item) => item.classification)).toEqual([
      "eligible",
      "eligible",
      "eligible",
    ]);
  });

  it("rejects globally inadequate training data before candidate analysis", () => {
    const candidate = {
      id: "x",
      source_column: "x",
      kind: "boolean_is",
      favorable_value: true,
      publicly_observable: true,
      question: "Is the company likely to match the tested business dimension?",
    } as CandidateSignal;
    expect(() =>
      deriveSignalEvidence([], [candidate], {
        bootstrapSeed: 1,
        bootstrapSamples: 10,
        minimumLabeledDeals: 4,
        minimumClassCount: 2,
        prohibitedColumns: [],
      }),
    ).toThrow(/labeled deals/i);
  });
});
