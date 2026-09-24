import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CandidateEvidence } from "../../src/analysis/evidence.js";
import type { PolicyManifest } from "../../src/case/schema.js";
import type { HoldoutEvaluation } from "../../src/evaluation/metrics.js";
import { AppError } from "../../src/shared/errors.js";

export const ExpectedPolicySchema = z.object({
  schema_version: z.literal("1.0"),
  case_id: z.string().min(1),
  selected_candidate_ids: z.array(z.string().min(1)),
  exact_questions: z.record(z.string(), z.string().min(1)),
  anti_pattern_ids: z.array(z.string().min(1)),
  rejected_candidates: z.record(z.string(), z.string().min(1)),
  minimum_policy_coverage: z.number().finite(),
  minimum_top_bucket_lift_pp: z.number().finite(),
  maximum_unacknowledged_vetoed_wins: z.number().int(),
});

export type ExpectedPolicy = z.infer<typeof ExpectedPolicySchema>;

export function loadExpectedPolicy(
  path = "fixtures/building-materials-distributor/expected-policy.json",
): ExpectedPolicy {
  return ExpectedPolicySchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000");
}

export interface SyntheticQualityGateInput {
  manifest: PolicyManifest;
  evidence: CandidateEvidence[];
  evaluation: HoldoutEvaluation;
  expected: ExpectedPolicy;
}

export function assertSyntheticQualityGates(input: SyntheticQualityGateInput): void {
  const failures: string[] = [];
  const selectedIds = input.manifest.question_additions.map((item) => item.candidate_id);
  if (!sameStrings(selectedIds, input.expected.selected_candidate_ids)) {
    failures.push(
      `Selected candidate IDs differ: expected ${input.expected.selected_candidate_ids.join(", ")}; got ${selectedIds.join(", ")}.`,
    );
  }
  for (const [candidateId, expectedText] of Object.entries(input.expected.exact_questions)) {
    const actual = input.manifest.question_additions.find(
      (item) => item.candidate_id === candidateId,
    )?.text;
    if (actual !== expectedText) {
      failures.push(`Question text for ${candidateId} differs from the independent expectation.`);
    }
  }
  const antiPatternIds = input.manifest.anti_pattern_additions.map((item) => item.veto_id);
  if (!sameStrings(antiPatternIds, input.expected.anti_pattern_ids)) {
    failures.push(
      `Anti-pattern IDs differ: expected ${input.expected.anti_pattern_ids.join(", ")}; got ${antiPatternIds.join(", ")}.`,
    );
  }
  const evidenceById = new Map(
    input.evidence.map((item) => [item.candidateId, item.classification]),
  );
  for (const [candidateId, expectedClassification] of Object.entries(
    input.expected.rejected_candidates,
  )) {
    const actual = evidenceById.get(candidateId);
    if (actual !== expectedClassification) {
      failures.push(
        `Evidence classification for ${candidateId} differs: expected ${expectedClassification}; got ${actual ?? "missing"}.`,
      );
    }
  }
  if (input.evaluation.policy_coverage < input.expected.minimum_policy_coverage) {
    failures.push(
      `Policy coverage ${input.evaluation.policy_coverage} is below ${input.expected.minimum_policy_coverage}.`,
    );
  }
  if (input.evaluation.top_bucket_lift_pp < input.expected.minimum_top_bucket_lift_pp) {
    failures.push(
      `Top-bucket lift ${input.evaluation.top_bucket_lift_pp}pp is below ${input.expected.minimum_top_bucket_lift_pp}pp.`,
    );
  }
  if (
    input.evaluation.unacknowledged_vetoed_win_ids.length >
    input.expected.maximum_unacknowledged_vetoed_wins
  ) {
    failures.push(
      `Unacknowledged vetoed wins ${input.evaluation.unacknowledged_vetoed_win_ids.length} exceed ${input.expected.maximum_unacknowledged_vetoed_wins}.`,
    );
  }
  if (failures.length > 0) {
    throw new AppError({
      code: "SYNTHETIC_QUALITY_GATE_FAILED",
      exitCode: 3,
      message: "The synthetic deployment case failed its independent test contract.",
      hint: "Inspect the fixture diagnostics and update the test oracle only when the intended case changes.",
      details: { failures, evaluation: input.evaluation },
    });
  }
}
