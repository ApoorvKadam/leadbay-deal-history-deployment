import type { CandidateEvidence } from "../analysis/evidence.js";
import type { SplitMembership } from "../analysis/split.js";
import type { IngestionResult } from "../case/load-case.js";
import type { CustomerBrief, LeadbayState, PolicyManifest } from "../case/schema.js";
import type { HoldoutEvaluation } from "../evaluation/metrics.js";
import type { ScoredRecord } from "../evaluation/score-policy.js";

export type ReportMode = "analysis_only" | "preview_only" | "complete";

export interface DeploymentReportInput {
  brief: CustomerBrief;
  state: LeadbayState;
  diagnostics: IngestionResult["diagnostics"];
  split: SplitMembership;
  evidence: CandidateEvidence[];
  manifest: PolicyManifest;
  evaluation: HoldoutEvaluation;
  prospectPreview: ScoredRecord[];
  mode: ReportMode;
  deploymentPreview?: unknown;
  limitations?: string[];
}

function percent(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

function list(items: string[], empty = "None."): string {
  return items.length === 0 ? empty : items.map((item) => `- ${item}`).join("\n");
}

function countPhrase(count: number, singular: string, plural: string): string {
  if (count === 0) return `no ${plural}`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function evidenceTable(evidence: CandidateEvidence[]): string {
  const rows = evidence.map(
    (item) =>
      `| ${item.candidateId} | ${item.classification} | ${item.effectPp.toFixed(1)} | ${percent(item.knownCoverage)} | ${item.directionStability.toFixed(3)} |`,
  );
  return [
    "| Candidate | Classification | Association (pp) | Known coverage | Direction stability |",
    "|---|---:|---:|---:|---:|",
    ...rows,
  ].join("\n");
}

function prospectTable(rows: ScoredRecord[]): string {
  if (rows.length === 0) return "No current prospects were scored.";
  return [
    "| Rank | Prospect | Local policy score | Known | Unknown | Vetoed |",
    "|---:|---|---:|---:|---:|---|",
    ...rows.map(
      (row) =>
        `| ${row.rank} | ${row.source_record_id} | ${row.local_policy_score} | ${row.known_signal_count} | ${row.unknown_signal_count} | ${row.vetoed ? row.veto_matches.join(", ") : "no"} |`,
    ),
  ].join("\n");
}

export function renderDeploymentReport(input: DeploymentReportInput): string {
  const selected = input.manifest.question_additions.map(
    (question) => `**${question.candidate_id}:** ${question.text}`,
  );
  const antiPatterns = input.manifest.anti_pattern_additions.map(
    (item) => `**${item.veto_id}:** ${item.text} _(source: customer brief)_`,
  );
  const rejected = input.evidence
    .filter((item) => item.classification !== "eligible")
    .map((item) => `${item.candidateId}: ${item.classification}`);
  const unknowns = Object.entries(input.evaluation.per_question).map(
    ([id, counts]) => `${id}: ${counts.missing} unknown of ${counts.known + counts.missing}`,
  );
  const preview =
    input.deploymentPreview === undefined
      ? `Not run in ${input.mode} mode. No Leadbay account state was changed.`
      : `Mock-only projected deployment:\n\n\`\`\`json\n${JSON.stringify(input.deploymentPreview, null, 2)}\n\`\`\``;

  const report = `# Leadbay deal-history deployment report

## 1. Executive summary

The local policy review selected ${countPhrase(input.manifest.question_additions.length, "question addition", "question additions")} and ${countPhrase(input.manifest.anti_pattern_additions.length, "explicit anti-pattern addition", "explicit anti-pattern additions")}. The held-out top bucket shows a ${input.evaluation.top_bucket_lift_pp.toFixed(1)} percentage-point association above the holdout baseline. These are deployment-review signals, not performance guarantees.

## 2. Customer objective and scenario disclosure

**Objective:** ${input.brief.business_goal.summary}

This report uses **synthetic data** for a fictional deployment scenario. The fixture generator deliberately plants recoverable signal and decoy structure so the workflow can be checked deterministically. It does not report customer performance, revenue impact, or production Leadbay behavior.

## 3. Source data and cohort

- Historical source rows: ${input.diagnostics.historical_source_rows}
- Normalized deals: ${input.diagnostics.normalized_deals}
- Company identity groups: ${input.diagnostics.identity_groups}
- Training rows: ${input.split.trainingDeals.length}
- Held-out rows: ${input.split.holdoutDeals.length}
- Grouped temporal holdout starts at: ${input.split.holdoutCutoffDate}

## 4. Data-quality findings

- Exact duplicate export rows collapsed: ${input.diagnostics.exact_duplicate_rows_collapsed}
- Normalization warnings: ${input.diagnostics.warning_count}
- Current prospects: ${input.diagnostics.current_prospects}

## 5. Leakage and prohibited-field decisions

Mapped outcome, loss-reason, and close-date columns are automatically unavailable to policy rules. The customer brief additionally excludes: ${input.brief.prohibited_columns.join(", ")}. Company identity groups were kept wholly within one temporal partition to avoid repeated-company leakage.

## 6. Current Leadbay configuration

- Region: ${input.state.region}
- Existing qualification questions: ${input.state.qualification_questions.length}
- Free question slots: ${5 - input.state.qualification_questions.length}
- Current anti-patterns: ${input.state.ideal_buyer_profile?.anti_patterns.join(", ") || "none"}
- Targeting prompt: ${input.state.targeting_prompt ?? "unset"}

## 7. Proposed qualification questions

${list(selected, "No question addition is proposed.")}

Rejected or reserved candidate outcomes:

${list(rejected, "None.")}

## 8. Explicit vetoes and anti-patterns

${list(antiPatterns, "No anti-pattern addition is proposed.")}

Every veto originates in the customer brief. Historical associations never create a hard veto.

## 9. Evidence table per proposal

${evidenceTable(input.evidence)}

Positive values describe an association between the candidate trait and historical wins in this synthetic cohort. They do not establish causation.

## 10. Held-out evaluation

- Baseline win rate: ${percent(input.evaluation.baseline_win_rate)}
- Top-bucket size: ${input.evaluation.top_bucket_size}
- Top-bucket win rate: ${percent(input.evaluation.top_bucket_win_rate)}
- Top-bucket lift: ${input.evaluation.top_bucket_lift_pp.toFixed(1)} percentage points
- Policy coverage: ${percent(input.evaluation.policy_coverage)}
- Wins captured in top half: ${input.evaluation.wins_captured_in_top_half}/${input.evaluation.total_wins}

## 11. Current-prospect preview

${prospectTable(input.prospectPreview)}

This is a local policy ordering. It is not a Leadbay score.

## 12. False positives, false negatives, and unknowns

- False positives in top bucket: ${input.evaluation.false_positive_ids.join(", ") || "none"}
- False negatives in bottom half: ${input.evaluation.false_negative_ids.join(", ") || "none"}
- Vetoed historical wins: ${input.evaluation.vetoed_historical_win_ids.join(", ") || "none"}
- Unknowns: ${unknowns.join("; ") || "none"}

## 13. Leadbay MCP deployment preview (locally projected state)

${preview}

## 14. Required human approvals

${list(input.manifest.required_human_approvals, "No write approval is currently requested.")}

Question additions affect scoring for all leads. They are previewed before anti-pattern additions because Leadbay's anti-pattern update can trigger targeting regeneration, lens refreshes, and, when questions have not been written by hand, possibly new questions. Public documentation does not state whether an MCP addition counts as hand-written, so this order avoids depending on that behavior. The anti-pattern update also draws on the org's AI quota and makes the buyer profile user-managed, so Leadbay stops rewriting that profile automatically. Those side effects belong in the approval conversation even though this repository never persists the mock write.

## 15. Monitoring plan for the first 30 days

- Track accepted, rejected, and unknown answers per proposed question.
- Review false positives and false negatives weekly with sales and RevOps.
- Re-check any explicit veto against newly won accounts before applying it.
- Compare lead quality by question state without treating association as mechanistic proof.

## 16. Limitations and non-claims

- The dataset and customer are synthetic.
- The customer brief marks proposed traits as publicly observable; this demo does not independently verify that Leadbay can infer each trait from public text.
- The CRM/enrichment evidence does not validate Leadbay's own public-text answer to a proposed question. A real deployment would qualify historical companies through Leadbay and compare those responses with won/lost outcomes.
- Candidate selection is marginal, not redundancy-aware. In this synthetic case, the field-sales territory and multi-site questions both carry geographic-reach information and would be reviewed for consolidation before customer approval.
- CRM fields reflect export-time state. A historical veto match needs a status at close check before concluding that the rule would have rejected a past win.
- Small-sample associations are governance aids, not statistical proof.
- The local policy score is not Leadbay's score.
- Mock-mode write previews are projected, not persisted.
${(input.limitations ?? []).map((item) => `- ${item}`).join("\n")}
`;
  return `${report.trimEnd()}\n`;
}

export interface SummaryInput {
  caseId: string;
  mode: ReportMode;
  selectedQuestionCount: number;
  antiPatternCount: number;
  policyCoverage: number;
  topBucketLiftPp: number;
  deploymentStatus: "not_run" | "blocked" | "projected";
}

export function renderSummary(input: SummaryInput): string {
  return [
    `Case: ${input.caseId}`,
    `Mode: ${input.mode}`,
    `Questions proposed: ${input.selectedQuestionCount}`,
    `Anti-patterns proposed: ${input.antiPatternCount}`,
    `Policy coverage: ${percent(input.policyCoverage)}`,
    `Top-bucket lift: ${input.topBucketLiftPp.toFixed(1)}pp`,
    `Deployment status: ${input.deploymentStatus}`,
    "No production write was performed.",
    "",
  ].join("\n");
}
