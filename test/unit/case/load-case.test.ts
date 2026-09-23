import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCaseMetadata, resolveCasePaths } from "../../../src/case/load-case.js";
import { AppError } from "../../../src/shared/errors.js";

const brief = {
  schema_version: 1,
  case_id: "case",
  customer: { name: "Customer", country: "US", language: "en" },
  business_goal: { summary: "Goal", positive_outcomes: ["Won"], negative_outcomes: ["Lost"] },
  analysis: {
    split_strategy: "grouped_temporal",
    holdout_fraction: 0.25,
    bootstrap_seed: 1,
    bootstrap_samples: 20,
    minimum_labeled_deals: 4,
    minimum_class_count: 2,
    minimum_holdout_class_count: 1,
  },
  columns: { record_id: "id", company_name: "name", outcome: "outcome", closed_at: "closed" },
  existing_lens_constraints: [],
  candidate_signals: [],
  explicit_vetoes: [],
  prohibited_columns: [],
};

function makeCase(): string {
  const root = mkdtempSync(join(tmpdir(), "leadbay-case-"));
  writeFileSync(join(root, "customer-brief.yaml"), JSON.stringify(brief));
  writeFileSync(join(root, "historical-deals.csv"), "id,name,outcome,closed\n");
  writeFileSync(join(root, "current-prospects.csv"), "id,name\n");
  writeFileSync(
    join(root, "leadbay-state.json"),
    JSON.stringify({
      schema_version: "1.0",
      region: "us",
      user: { id: "u", admin: true, organization: { id: 1, name: "Org" } },
      qualification_questions: [],
      ideal_buyer_profile: null,
      targeting_prompt: null,
    }),
  );
  writeFileSync(
    join(root, "expected-policy.json"),
    JSON.stringify({
      schema_version: "1.0",
      case_id: "case",
      selected_candidate_ids: [],
      exact_questions: {},
      anti_pattern_ids: [],
      rejected_candidates: {},
      minimum_policy_coverage: 0,
      minimum_top_bucket_lift_pp: 0,
      maximum_unacknowledged_vetoed_wins: 0,
    }),
  );
  return root;
}

describe("resolveCasePaths", () => {
  it("throws CASE_FILE_MISSING for a missing brief", () => {
    const root = mkdtempSync(join(tmpdir(), "leadbay-case-"));
    let error: unknown;
    try {
      resolveCasePaths(root);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof AppError).toBe(true);
    expect((error as AppError).code).toBe("CASE_FILE_MISSING");
    expect((error as AppError).exitCode).toBe(2);
  });

  it("resolves all five required paths under the real root", () => {
    const root = makeCase();
    const paths = resolveCasePaths(root);
    expect(Object.values(paths).filter((value) => typeof value === "string")).toHaveLength(6);
    expect(paths.customerBrief.startsWith(paths.root)).toBe(true);
  });

  it("rejects a required-file symlink that resolves outside the case root", () => {
    const root = makeCase();
    const outside = mkdtempSync(join(tmpdir(), "leadbay-outside-"));
    writeFileSync(join(outside, "state.json"), "{}");
    const linkRoot = mkdtempSync(join(tmpdir(), "leadbay-linkcase-"));
    mkdirSync(join(linkRoot, "nested"));
    for (const name of [
      "customer-brief.yaml",
      "historical-deals.csv",
      "current-prospects.csv",
      "expected-policy.json",
    ]) {
      symlinkSync(join(root, name), join(linkRoot, name));
    }
    symlinkSync(join(outside, "state.json"), join(linkRoot, "leadbay-state.json"));
    expect(() => resolveCasePaths(linkRoot)).toThrow(/CASE_PATH_ESCAPE|outside/i);
  });
});

describe("loadCaseMetadata", () => {
  it("accepts core-YAML folded scalars rather than a project-specific subset", () => {
    const root = makeCase();
    writeFileSync(
      join(root, "customer-brief.yaml"),
      [
        "schema_version: 1",
        "case_id: case",
        "customer:",
        "  name: Customer",
        "  country: US",
        "  language: en",
        "business_goal:",
        "  summary: >",
        "    Find regional contractors",
        "    through field sales.",
        "  positive_outcomes: [Won]",
        "  negative_outcomes: [Lost]",
        "analysis:",
        "  split_strategy: grouped_temporal",
        "  holdout_fraction: 0.25",
        "  bootstrap_seed: 1",
        "  bootstrap_samples: 20",
        "  minimum_labeled_deals: 4",
        "  minimum_class_count: 2",
        "  minimum_holdout_class_count: 1",
        "columns:",
        "  record_id: id",
        "  company_name: name",
        "  outcome: outcome",
        "  closed_at: closed",
        "existing_lens_constraints: []",
        "candidate_signals: []",
        "explicit_vetoes: []",
        "prohibited_columns: []",
        "",
      ].join("\n"),
    );
    expect(loadCaseMetadata(root).brief.business_goal.summary).toBe(
      "Find regional contractors through field sales.\n",
    );
  });

  it("wraps malformed YAML as CASE_YAML_INVALID", () => {
    const root = makeCase();
    writeFileSync(join(root, "customer-brief.yaml"), "case_id: [");
    let error: unknown;
    try {
      loadCaseMetadata(root);
    } catch (caught) {
      error = caught;
    }
    expect((error as AppError).code).toBe("CASE_YAML_INVALID");
  });

  it("never evaluates custom YAML tags", () => {
    const root = makeCase();
    writeFileSync(join(root, "customer-brief.yaml"), "case_id: !evil value");
    expect(() => loadCaseMetadata(root)).toThrow(/custom YAML tags|CASE_YAML_INVALID/i);
  });

  it("returns validated metadata", () => {
    const loaded = loadCaseMetadata(makeCase());
    expect(loaded.brief.case_id).toBe("case");
    expect(loaded.state.region).toBe("us");
  });
});
