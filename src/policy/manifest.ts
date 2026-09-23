import type { CandidateEvidence } from "../analysis/evidence.js";
import type { SplitMembership } from "../analysis/split.js";
import type { CustomerBrief, LeadbayState, PolicyManifest } from "../case/schema.js";
import { PolicyManifestSchema } from "../case/schema.js";
import type { NormalizedDeal, NormalizedProspect } from "../ingestion/normalize-row.js";
import { sha256Stable } from "../shared/stable-json.js";
import type { PolicySelection } from "./select-policy.js";

export interface BuildPolicyManifestInput {
  brief: CustomerBrief;
  state: LeadbayState;
  deals: NormalizedDeal[];
  prospects: NormalizedProspect[];
  split: SplitMembership;
  evidence: CandidateEvidence[];
  selection: PolicySelection;
}

function sortedById<T extends { sourceRecordId: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
}

export function buildPolicyManifest(input: BuildPolicyManifestInput): PolicyManifest {
  const sourceFingerprint = sha256Stable({
    brief: input.brief,
    leadbay_state: input.state,
    normalized_deals: sortedById(input.deals),
    normalized_prospects: sortedById(input.prospects),
    split_membership: input.split.membership,
  });
  const manifest: PolicyManifest = {
    schema_version: "1.0",
    case_id: input.brief.case_id,
    scenario: "synthetic",
    source_fingerprint: sourceFingerprint,
    split: {
      strategy: "grouped_temporal",
      bootstrap_seed: input.brief.analysis.bootstrap_seed,
      training_rows: input.split.trainingDeals.length,
      holdout_rows: input.split.holdoutDeals.length,
      holdout_cutoff_date: input.split.holdoutCutoffDate,
    },
    leadbay_state: {
      existing_question_count: input.selection.existingQuestionCount,
      free_question_slots: input.selection.freeQuestionSlots,
    },
    question_additions: input.selection.questionAdditions.map((item) => ({
      candidate_id: item.candidateId,
      text: item.text,
      source: "historical_evidence",
      effect_pp: item.evidence.effectPp,
      direction_stability: item.evidence.directionStability,
      training_support: item.evidence.trueRows,
    })),
    reserve_signals: input.selection.reserveSignals.map((item) => ({
      candidate_id: item.candidateId,
      text: item.text,
      priority: item.priority,
      reason: item.reason,
      ...(item.duplicateSurface ? { duplicate_surface: item.duplicateSurface } : {}),
      ...(item.duplicateText ? { duplicate_text: item.duplicateText } : {}),
      ...(item.issues ? { issues: item.issues } : {}),
    })),
    anti_pattern_additions: input.selection.antiPatternAdditions.map((item) => ({
      veto_id: item.vetoId,
      text: item.text,
      source: "customer_brief",
    })),
    required_human_approvals: [...input.selection.requiredHumanApprovals],
  };
  return PolicyManifestSchema.parse(manifest);
}
