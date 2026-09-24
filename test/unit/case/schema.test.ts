import { describe, expect, it } from "vitest";
import {
  CustomerBriefSchema,
  LeadbayStateSchema,
  PolicyManifestSchema,
} from "../../../src/case/schema.js";

const validBrief = {
  schema_version: 1,
  case_id: "building-materials-distributor",
  customer: { name: "Northstar Building Supply", country: "US", language: "en" },
  business_goal: {
    summary: "Find regional contractors and suppliers likely to buy through field sales.",
    positive_outcomes: ["Won"],
    negative_outcomes: ["Lost"],
  },
  analysis: {
    split_strategy: "grouped_temporal",
    holdout_fraction: 0.25,
    bootstrap_seed: 20260922,
    bootstrap_samples: 200,
    minimum_labeled_deals: 40,
    minimum_class_count: 12,
    minimum_holdout_class_count: 5,
  },
  columns: {
    record_id: "CRM Record ID",
    company_name: "Account Name",
    website: "Company Website",
    contact_email: "Primary Contact Email",
    outcome: "Deal Result",
    loss_reason: "Loss Reason",
    closed_at: "Close Date",
  },
  existing_lens_constraints: ["United States only"],
  candidate_signals: [
    {
      id: "multi_territory_field_sales",
      source_column: "Sales Motion",
      kind: "categorical_in",
      favorable_values: ["Field sales"],
      publicly_observable: true,
      question: "Is the company likely to operate field-sales teams across multiple territories?",
    },
  ],
  explicit_vetoes: [],
  prohibited_columns: ["Deal Stage"],
};

describe("CustomerBriefSchema", () => {
  it("is a Zod boundary with safeParse semantics", () => {
    const schema = CustomerBriefSchema as typeof CustomerBriefSchema & {
      safeParse?: (input: unknown) => { success: boolean };
    };
    expect(typeof schema.safeParse).toBe("function");
    expect(schema.safeParse?.(validBrief).success).toBe(true);
    expect(schema.safeParse?.({}).success).toBe(false);
  });

  it("accepts the supported version-1 contract", () => {
    expect(CustomerBriefSchema.parse(validBrief).case_id).toBe("building-materials-distributor");
  });

  it("rejects overlapping positive and negative outcomes", () => {
    const invalid = structuredClone(validBrief);
    invalid.business_goal.negative_outcomes = ["Won"];
    expect(() => CustomerBriefSchema.parse(invalid)).toThrow(/overlap/i);
  });

  it("rejects a non-estimative or overlong Leadbay question", () => {
    const invalid = structuredClone(validBrief);
    invalid.candidate_signals[0]!.question = "Does the company have field sales?";
    expect(() => CustomerBriefSchema.parse(invalid)).toThrow(/Is the company likely to/);
  });

  it("rejects rules sourced from mapped outcome fields even when the brief omits them from prohibited_columns", () => {
    for (const sourceColumn of ["Deal Result", "Loss Reason", "Close Date"]) {
      const invalid = structuredClone(validBrief);
      invalid.candidate_signals[0]!.source_column = sourceColumn;
      expect(() => CustomerBriefSchema.parse(invalid)).toThrow(/prohibited|outcome|post-outcome/i);
    }
  });

  it("rejects duplicate rule ids and prohibited source columns", () => {
    const invalid = structuredClone(validBrief);
    invalid.candidate_signals.push({
      ...invalid.candidate_signals[0]!,
      source_column: "Deal Stage",
    });
    expect(() => CustomerBriefSchema.parse(invalid)).toThrow(/duplicate|prohibited/i);
  });
});

describe("LeadbayStateSchema", () => {
  it("rejects more than five current questions", () => {
    expect(() =>
      LeadbayStateSchema.parse({
        schema_version: "1.0",
        region: "us",
        user: { id: "u", admin: true, organization: { id: 1, name: "Org" } },
        qualification_questions: Array.from({ length: 6 }, (_, index) => ({
          question: `Is the company likely to satisfy dimension ${index}?`,
          lang: "en",
        })),
        ideal_buyer_profile: null,
        targeting_prompt: null,
      }),
    ).toThrow(/five/i);
  });
});

describe("PolicyManifestSchema", () => {
  it("rejects an anti-pattern whose source is not customer_brief", () => {
    expect(() =>
      PolicyManifestSchema.parse({
        schema_version: "1.0",
        case_id: "x",
        scenario: "synthetic",
        source_fingerprint: "sha256:abc",
        split: {
          strategy: "grouped_temporal",
          bootstrap_seed: 1,
          training_rows: 40,
          holdout_rows: 10,
          holdout_cutoff_date: "2026-01-01",
        },
        leadbay_state: { existing_question_count: 0, free_question_slots: 5 },
        question_additions: [],
        reserve_signals: [],
        anti_pattern_additions: [{ veto_id: "x", text: "x", source: "historical_evidence" }],
        required_human_approvals: [],
      }),
    ).toThrow(/customer_brief/);
  });
});
