import {
  type TriState,
  evaluateCandidatePredicate,
  evaluateVetoPredicate,
} from "../analysis/predicates.js";
import type {
  CandidateSignal,
  CustomerBrief,
  ExplicitVeto,
  PolicyManifest,
} from "../case/schema.js";
import type { NormalizedDeal, NormalizedProspect } from "../ingestion/normalize-row.js";
import { AppError } from "../shared/errors.js";

export interface ScoredRecord {
  rank: number;
  source_record_id: string;
  company_name: string;
  outcome: "positive" | "negative" | null;
  local_policy_score: number;
  known_signal_count: number;
  unknown_signal_count: number;
  signal_states: Record<string, TriState>;
  vetoed: boolean;
  veto_matches: string[];
  veto_unknown_count: number;
}

export type ProspectPreviewRow = ScoredRecord;

type ScorableRow = NormalizedDeal | NormalizedProspect;

function selectedCandidates(brief: CustomerBrief, manifest: PolicyManifest): CandidateSignal[] {
  const byId = new Map(brief.candidate_signals.map((candidate) => [candidate.id, candidate]));
  return manifest.question_additions.map((addition) => {
    const candidate = byId.get(addition.candidate_id);
    if (!candidate) {
      throw new AppError({
        code: "POLICY_CANDIDATE_NOT_FOUND",
        exitCode: 3,
        message: `Policy candidate ${addition.candidate_id} is missing from the customer brief.`,
        hint: "Regenerate the manifest from the same validated case inputs before scoring.",
        details: { candidate_id: addition.candidate_id },
      });
    }
    return candidate;
  });
}

function explicitVetoes(brief: CustomerBrief): ExplicitVeto[] {
  return [...brief.explicit_vetoes].sort((left, right) => left.id.localeCompare(right.id));
}

function outcomeOf(row: ScorableRow): "positive" | "negative" | null {
  return "outcome" in row ? row.outcome : null;
}

export function scorePolicy(
  rows: ScorableRow[],
  brief: CustomerBrief,
  manifest: PolicyManifest,
): ScoredRecord[] {
  const candidates = selectedCandidates(brief, manifest);
  const vetoes = explicitVetoes(brief);
  const scored = rows.map((row): Omit<ScoredRecord, "rank"> => {
    const signalStates: Record<string, TriState> = {};
    let localPolicyScore = 0;
    let knownSignalCount = 0;
    let unknownSignalCount = 0;
    for (const candidate of candidates) {
      const state = evaluateCandidatePredicate(row, candidate);
      signalStates[candidate.id] = state;
      if (state === "unknown") unknownSignalCount++;
      else {
        knownSignalCount++;
        if (state === true) localPolicyScore++;
      }
    }

    const vetoMatches: string[] = [];
    let vetoUnknownCount = 0;
    for (const veto of vetoes) {
      const state = evaluateVetoPredicate(row, veto);
      if (state === true) vetoMatches.push(veto.id);
      else if (state === "unknown") vetoUnknownCount++;
    }

    return {
      source_record_id: row.sourceRecordId,
      company_name: row.originalCompanyName,
      outcome: outcomeOf(row),
      local_policy_score: localPolicyScore,
      known_signal_count: knownSignalCount,
      unknown_signal_count: unknownSignalCount,
      signal_states: signalStates,
      vetoed: vetoMatches.length > 0,
      veto_matches: vetoMatches,
      veto_unknown_count: vetoUnknownCount,
    };
  });

  return scored
    .sort(
      (left, right) =>
        Number(left.vetoed) - Number(right.vetoed) ||
        right.local_policy_score - left.local_policy_score ||
        right.known_signal_count - left.known_signal_count ||
        left.source_record_id.localeCompare(right.source_record_id),
    )
    .map((row, index) => ({ rank: index + 1, ...row }));
}
