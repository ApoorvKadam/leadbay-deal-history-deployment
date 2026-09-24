import { describe, expect, it } from "vitest";
import type { CandidateEvidence } from "../../../src/analysis/evidence.js";
import type { SplitMembership } from "../../../src/analysis/split.js";
import { loadCase } from "../../../src/case/load-case.js";
import type { PolicyManifest } from "../../../src/case/schema.js";
import type { HoldoutEvaluation } from "../../../src/evaluation/metrics.js";
import type { ScoredRecord } from "../../../src/evaluation/score-policy.js";
import { renderDeploymentReport, renderSummary } from "../../../src/reporting/markdown-report.js";

const headings = [
  "Executive summary",
  "Customer objective and scenario disclosure",
  "Source data and cohort",
  "Data-quality findings",
  "Leakage and prohibited-field decisions",
  "Current Leadbay configuration",
  "Proposed qualification questions",
  "Explicit vetoes and anti-patterns",
  "Evidence table per proposal",
  "Held-out evaluation",
  "Current-prospect preview",
  "False positives, false negatives, and unknowns",
  "Leadbay MCP deployment preview (locally projected state)",
  "Required human approvals",
  "Monitoring plan for the first 30 days",
  "Limitations and non-claims",
];

describe("renderDeploymentReport", () => {
  it("renders every specified section exactly once and in order without causal claims", () => {
    const loaded = loadCase("fixtures/building-materials-distributor");
    const report = renderDeploymentReport({
      brief: loaded.brief,
      state: loaded.state,
      diagnostics: loaded.ingestion.diagnostics,
      split: {
        trainingIds: [],
        holdoutIds: [],
        trainingDeals: [],
        holdoutDeals: [],
        actualHoldoutFraction: 0.25,
        holdoutCutoffDate: "2026-01-01",
        membership: {},
      } satisfies SplitMembership,
      evidence: [
        {
          candidateId: "enterprise_scale",
          question: "Is the company likely to operate at enterprise scale?",
          classification: "contradicted",
          effectPp: -20,
          knownCoverage: 1,
          directionStability: 1,
        } as CandidateEvidence,
      ],
      manifest: {
        question_additions: [],
        anti_pattern_additions: [
          {
            veto_id: "inactive_company",
            text: "Inactive companies",
          },
        ],
        required_human_approvals: ["qualification_question_additions"],
      } as unknown as PolicyManifest,
      evaluation: {
        holdout_rows: 20,
        baseline_win_rate: 0.5,
        top_bucket_size: 5,
        top_bucket_win_rate: 0.8,
        top_bucket_lift_pp: 30,
        wins_captured_in_top_half: 8,
        total_wins: 10,
        top_half_win_capture_rate: 0.8,
        policy_coverage: 0.95,
        false_positive_ids: ["D-1"],
        false_negative_ids: ["D-2"],
        vetoed_historical_win_ids: [],
        unacknowledged_vetoed_win_ids: [],
        per_question: {},
      } satisfies HoldoutEvaluation,
      prospectPreview: [] as ScoredRecord[],
      mode: "analysis_only",
    });
    let previous = -1;
    headings.forEach((heading, index) => {
      const marker = `## ${index + 1}. ${heading}`;
      expect(report.split(marker)).toHaveLength(2);
      const current = report.indexOf(marker);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    });
    expect(report).toContain("synthetic data");
    expect(report).toContain("association");
    expect(report).not.toMatch(/\bcaused?\b/i);
    expect(report).toContain("enterprise_scale");
    expect(report).toContain("contradicted");
    expect(report).toContain("qualification_question_additions");
    expect(report).toMatch(/anti-pattern.*targeting regeneration/i);
    expect(report).toMatch(/AI quota/i);
    expect(report).toMatch(/question additions.*scoring.*all leads/i);
    expect(report).toMatch(/status at close/i);
    expect(report).not.toContain("(s)");
    expect(report).toContain(
      "The local policy review selected no question additions and 1 explicit anti-pattern addition.",
    );
    expect(report.endsWith("\n")).toBe(true);
    expect(report.endsWith("\n\n")).toBe(false);
  });
});

describe("renderSummary", () => {
  it("states the mode and deployment gate without overstating persistence", () => {
    expect(
      renderSummary({
        caseId: "case",
        mode: "analysis_only",
        selectedQuestionCount: 3,
        antiPatternCount: 1,
        policyCoverage: 0.9,
        topBucketLiftPp: 20,
        deploymentStatus: "not_run",
      }),
    ).toContain("not_run");
  });
});
