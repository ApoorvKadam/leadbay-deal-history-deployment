import type { CustomerBrief } from "../../../src/case/schema.js";

export function makeBrief(): CustomerBrief {
  return {
    schema_version: 1,
    case_id: "ingestion-case",
    customer: { name: "Synthetic Customer", country: "US", language: "en" },
    business_goal: {
      summary: "Learn a safe qualification policy.",
      positive_outcomes: ["Won"],
      negative_outcomes: ["Lost"],
    },
    analysis: {
      split_strategy: "grouped_temporal",
      holdout_fraction: 0.25,
      bootstrap_seed: 20260922,
      bootstrap_samples: 50,
      minimum_labeled_deals: 4,
      minimum_class_count: 2,
      minimum_holdout_class_count: 1,
    },
    columns: {
      record_id: "Deal ID",
      company_name: "Company",
      website: "Website",
      contact_email: "Contact Email",
      location: "Location",
      outcome: "Outcome",
      loss_reason: "Loss Reason",
      closed_at: "Closed At",
    },
    existing_lens_constraints: [],
    candidate_signals: [
      {
        id: "revenue_scale",
        source_column: "Revenue",
        kind: "numeric_gte",
        threshold: 100,
        publicly_observable: true,
        question: "Is the company likely to have at least moderate operating scale?",
      },
      {
        id: "active_company",
        source_column: "Active",
        kind: "boolean_is",
        favorable_value: true,
        publicly_observable: true,
        question: "Is the company likely to be actively trading today?",
      },
      {
        id: "field_sales",
        source_column: "Sales Motion",
        kind: "categorical_in",
        favorable_values: ["Field Sales"],
        publicly_observable: true,
        question: "Is the company likely to operate a field-sales motion?",
      },
    ],
    explicit_vetoes: [],
    prohibited_columns: ["Final Stage"],
  };
}
