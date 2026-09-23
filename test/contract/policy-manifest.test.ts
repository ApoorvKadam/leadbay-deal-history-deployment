import { describe, expect, it } from "vitest";
import { deriveSignalEvidence } from "../../src/analysis/evidence.js";
import { groupedTemporalSplit } from "../../src/analysis/split.js";
import { loadCase } from "../../src/case/load-case.js";
import { PolicyManifestSchema } from "../../src/case/schema.js";
import { buildPolicyManifest } from "../../src/policy/manifest.js";
import { selectPolicy } from "../../src/policy/select-policy.js";

function build() {
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
  return {
    loaded,
    manifest: buildPolicyManifest({
      brief: loaded.brief,
      state: loaded.state,
      deals: loaded.ingestion.deals,
      prospects: loaded.ingestion.prospects,
      split,
      evidence,
      selection,
    }),
  };
}

describe("buildPolicyManifest", () => {
  it("builds a deterministic schema-valid, slot-safe manifest", () => {
    const first = build();
    const second = build();
    expect(PolicyManifestSchema.parse(first.manifest)).toEqual(first.manifest);
    expect(first.manifest).toEqual(second.manifest);
    expect(first.manifest.source_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.manifest.leadbay_state).toEqual({
      existing_question_count: 2,
      free_question_slots: 3,
    });
    expect(first.manifest.question_additions.map((item) => item.candidate_id).sort()).toEqual([
      "crm_exportability",
      "fragmented_smb_market",
      "multi_territory_field_sales",
    ]);
    expect(first.manifest.anti_pattern_additions).toEqual([
      {
        veto_id: "inactive_company",
        text: "Inactive, dissolved, or liquidated companies",
        source: "customer_brief",
      },
    ]);
    expect(first.manifest.required_human_approvals.sort()).toEqual([
      "ideal_buyer_profile_anti_pattern_additions",
      "qualification_question_additions",
    ]);
  });

  it("changes its source fingerprint when a normalized prospect changes", () => {
    const baseline = build();
    const changed = buildPolicyManifest({
      brief: baseline.loaded.brief,
      state: baseline.loaded.state,
      deals: baseline.loaded.ingestion.deals,
      prospects: baseline.loaded.ingestion.prospects.map((prospect, index) =>
        index === 0
          ? { ...prospect, fields: { ...prospect.fields, "Employee Count": 999 } }
          : prospect,
      ),
      split: groupedTemporalSplit(baseline.loaded.ingestion.deals, {
        holdoutFraction: baseline.loaded.brief.analysis.holdout_fraction,
        minimumTrainingClassCount: baseline.loaded.brief.analysis.minimum_class_count,
        minimumHoldoutClassCount: baseline.loaded.brief.analysis.minimum_holdout_class_count,
      }),
      evidence: [],
      selection: selectPolicy({
        brief: baseline.loaded.brief,
        state: baseline.loaded.state,
        evidence: [],
        deals: baseline.loaded.ingestion.deals,
      }),
    });
    expect(changed.source_fingerprint).not.toBe(baseline.manifest.source_fingerprint);
  });
});
