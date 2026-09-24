import { describe, expect, it } from "vitest";
import { loadCase } from "../../../src/case/load-case.js";
import type { CustomerBrief, PolicyManifest } from "../../../src/case/schema.js";
import { scorePolicy } from "../../../src/evaluation/score-policy.js";
import type { NormalizedDeal, NormalizedProspect } from "../../../src/ingestion/normalize-row.js";

function setup(): { brief: CustomerBrief; manifest: PolicyManifest } {
  const loaded = loadCase("fixtures/building-materials-distributor");
  const candidates = loaded.brief.candidate_signals.slice(0, 2);
  return {
    brief: { ...loaded.brief, candidate_signals: candidates },
    manifest: {
      schema_version: "1.0",
      case_id: loaded.brief.case_id,
      scenario: "synthetic",
      source_fingerprint: `sha256:${"0".repeat(64)}`,
      split: {
        strategy: "grouped_temporal",
        bootstrap_seed: 1,
        training_rows: 4,
        holdout_rows: 4,
        holdout_cutoff_date: "2025-01-01",
      },
      leadbay_state: { existing_question_count: 0, free_question_slots: 5 },
      question_additions: candidates.map((candidate) => ({
        candidate_id: candidate.id,
        text: candidate.question,
        source: "historical_evidence" as const,
        effect_pp: 20,
        direction_stability: 0.9,
        training_support: 10,
      })),
      reserve_signals: [],
      anti_pattern_additions: loaded.brief.explicit_vetoes.map((veto) => ({
        veto_id: veto.id,
        text: veto.anti_pattern,
        source: "customer_brief" as const,
      })),
      required_human_approvals: [],
    },
  };
}

function prospect(
  id: string,
  field: unknown,
  fragmented: unknown,
  legalStatus: unknown,
): NormalizedProspect {
  return {
    sourceRowNumbers: [2],
    sourceRecordId: id,
    companyIdentityGroupId: `deal:${id}`,
    originalCompanyName: id,
    normalizedCompanyName: id.toLowerCase(),
    normalizedLocation: null,
    canonicalDomain: null,
    domainSource: "none",
    fields: {
      "Sales Motion": field as never,
      "Customer Base": fragmented as never,
      "Legal Status": legalStatus as never,
    },
    warnings: [],
  };
}

describe("scorePolicy", () => {
  it("adds only favorable known signals and counts unknowns", () => {
    const { brief, manifest } = setup();
    const [row] = scorePolicy(
      [prospect("A", "Field sales", "Enterprise accounts", null)],
      brief,
      manifest,
    );
    expect(row?.local_policy_score).toBe(1);
    expect(row?.known_signal_count).toBe(2);
    expect(row?.unknown_signal_count).toBe(0);
    expect(row?.signal_states).toEqual({
      multi_territory_field_sales: true,
      fragmented_smb_market: false,
    });
    expect(row?.veto_matches).toHaveLength(0);
    expect(row?.veto_unknown_count).toBe(1);
    expect(JSON.stringify(row)).not.toContain("leadbay_score");
  });

  it("places a known veto after every non-vetoed row regardless of numeric score", () => {
    const { brief, manifest } = setup();
    const ranked = scorePolicy(
      [
        prospect("VETO", "Field sales", "Fragmented SMB", "Inactive"),
        prospect("LOW", "Inside sales", "Enterprise accounts", "Active"),
      ],
      brief,
      manifest,
    );
    expect(ranked.map((row) => row.source_record_id)).toEqual(["LOW", "VETO"]);
    expect(ranked[0]?.local_policy_score).toBe(0);
    expect(ranked[1]?.local_policy_score).toBe(2);
    expect(ranked[1]?.veto_matches).toEqual(["inactive_company"]);
  });

  it("treats a missing veto as unknown and not vetoed", () => {
    const { brief, manifest } = setup();
    const [row] = scorePolicy(
      [prospect("UNKNOWN", "Field sales", "Fragmented SMB", null)],
      brief,
      manifest,
    );
    expect(row?.vetoed).toBe(false);
    expect(row?.veto_unknown_count).toBe(1);
  });

  it("breaks ties by known count and then source record id", () => {
    const { brief, manifest } = setup();
    const ranked = scorePolicy(
      [
        prospect("C", "Field sales", null, "Active"),
        prospect("B", "Field sales", "Enterprise accounts", "Active"),
        prospect("A", "Field sales", "Enterprise accounts", "Active"),
      ],
      brief,
      manifest,
    );
    expect(ranked.map((row) => row.source_record_id)).toEqual(["A", "B", "C"]);
    expect(ranked.map((row) => row.known_signal_count)).toEqual([2, 2, 1]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("retains holdout outcomes without changing scoring semantics", () => {
    const { brief, manifest } = setup();
    const base = prospect("D", "Field sales", "Fragmented SMB", "Active");
    const deal: NormalizedDeal = {
      ...base,
      closeDate: "2026-01-01",
      outcome: "positive",
    };
    expect(scorePolicy([deal], brief, manifest)[0]?.outcome).toBe("positive");
  });
});
