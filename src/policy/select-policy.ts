import type { CandidateEvidence } from "../analysis/evidence.js";
import { sortEligibleEvidence } from "../analysis/evidence.js";
import { evaluateVetoPredicate } from "../analysis/predicates.js";
import type { CustomerBrief, LeadbayState } from "../case/schema.js";
import type { NormalizedDeal } from "../ingestion/normalize-row.js";
import {
  type RuleSurface,
  type RuleText,
  findDuplicateRule,
  validateQuestion,
} from "./question-rules.js";

export interface SelectedQuestion {
  candidateId: string;
  text: string;
  evidence: CandidateEvidence;
}

export type ReserveReason = "duplicate" | "slot_limit" | "no_free_slots" | "invalid_question";

export interface ReserveSignal {
  candidateId: string;
  text: string;
  priority: number;
  reason: ReserveReason;
  duplicateSurface?: RuleSurface;
  duplicateText?: string;
  issues?: string[];
}

export interface AntiPatternAddition {
  vetoId: string;
  text: string;
  source: "customer_brief";
  historicalWinIds: string[];
  tradeoffAcknowledged: boolean;
}

export interface PolicySelection {
  existingQuestionCount: number;
  freeQuestionSlots: number;
  questionAdditions: SelectedQuestion[];
  reserveSignals: ReserveSignal[];
  swapCandidates: SelectedQuestion[];
  antiPatternAdditions: AntiPatternAddition[];
  vetoedHistoricalWinIds: string[];
  deploymentBlocked: boolean;
  requiredHumanApprovals: Array<
    "qualification_question_additions" | "ideal_buyer_profile_anti_pattern_additions"
  >;
}

export interface SelectPolicyInput {
  brief: CustomerBrief;
  state: LeadbayState;
  evidence: CandidateEvidence[];
  deals: NormalizedDeal[];
}

function currentRules(brief: CustomerBrief, state: LeadbayState): RuleText[] {
  return [
    ...state.qualification_questions.map((item) => ({
      surface: "existing_question" as const,
      text: item.question,
    })),
    ...(state.ideal_buyer_profile?.anti_patterns ?? []).map((text) => ({
      surface: "anti_pattern" as const,
      text,
    })),
    ...(state.targeting_prompt
      ? [{ surface: "targeting_prompt" as const, text: state.targeting_prompt }]
      : []),
    ...brief.existing_lens_constraints.map((text) => ({
      surface: "lens_constraint" as const,
      text,
    })),
  ];
}

export function selectPolicy(input: SelectPolicyInput): PolicySelection {
  const existingQuestionCount = input.state.qualification_questions.length;
  const freeQuestionSlots = Math.max(0, 5 - existingQuestionCount);
  const candidateById = new Map(
    input.brief.candidate_signals.map((candidate) => [candidate.id, candidate]),
  );
  const ranked = sortEligibleEvidence(input.evidence);
  const additions: SelectedQuestion[] = [];
  const reserves: ReserveSignal[] = [];
  const swapCandidates: SelectedQuestion[] = [];
  const rules = currentRules(input.brief, input.state);

  for (const evidence of ranked) {
    const candidate = candidateById.get(evidence.candidateId);
    if (!candidate) continue;
    const validation = validateQuestion(candidate.question, {
      language: input.brief.customer.language,
      customerName: input.brief.customer.name,
    });
    if (!validation.valid) {
      reserves.push({
        candidateId: candidate.id,
        text: candidate.question,
        priority: evidence.priority,
        reason: "invalid_question",
        issues: validation.issues,
      });
      continue;
    }
    const duplicate = findDuplicateRule(candidate.question, rules);
    if (duplicate) {
      reserves.push({
        candidateId: candidate.id,
        text: candidate.question,
        priority: evidence.priority,
        reason: "duplicate",
        duplicateSurface: duplicate.surface,
        duplicateText: duplicate.text,
      });
      continue;
    }
    const selected = { candidateId: candidate.id, text: candidate.question, evidence };
    if (freeQuestionSlots === 0) {
      swapCandidates.push(selected);
      reserves.push({
        candidateId: candidate.id,
        text: candidate.question,
        priority: evidence.priority,
        reason: "no_free_slots",
      });
      continue;
    }
    if (additions.length >= Math.min(3, freeQuestionSlots)) {
      reserves.push({
        candidateId: candidate.id,
        text: candidate.question,
        priority: evidence.priority,
        reason: "slot_limit",
      });
      continue;
    }
    additions.push(selected);
    rules.push({ surface: "proposal", text: candidate.question });
  }

  const currentAntiPatterns = input.state.ideal_buyer_profile?.anti_patterns ?? [];
  const antiPatternAdditions: AntiPatternAddition[] = [];
  const allVetoedWins = new Set<string>();
  let deploymentBlocked = false;
  for (const veto of input.brief.explicit_vetoes) {
    const alreadyConfigured = currentAntiPatterns.some((current) =>
      findDuplicateRule(veto.anti_pattern, [{ surface: "anti_pattern", text: current }]),
    );
    const historicalWinIds = input.deals
      .filter((deal) => deal.outcome === "positive" && evaluateVetoPredicate(deal, veto) === true)
      .map((deal) => deal.sourceRecordId)
      .sort();
    for (const id of historicalWinIds) allVetoedWins.add(id);
    if (historicalWinIds.length > 0 && !veto.historical_win_tradeoff_acknowledged) {
      deploymentBlocked = true;
    }
    if (!alreadyConfigured) {
      antiPatternAdditions.push({
        vetoId: veto.id,
        text: veto.anti_pattern,
        source: "customer_brief",
        historicalWinIds,
        tradeoffAcknowledged: veto.historical_win_tradeoff_acknowledged,
      });
    }
  }

  const requiredHumanApprovals: PolicySelection["requiredHumanApprovals"] = [];
  if (additions.length > 0) requiredHumanApprovals.push("qualification_question_additions");
  if (antiPatternAdditions.length > 0) {
    requiredHumanApprovals.push("ideal_buyer_profile_anti_pattern_additions");
  }
  return {
    existingQuestionCount,
    freeQuestionSlots,
    questionAdditions: additions,
    reserveSignals: reserves,
    swapCandidates,
    antiPatternAdditions,
    vetoedHistoricalWinIds: [...allVetoedWins].sort(),
    deploymentBlocked,
    requiredHumanApprovals,
  };
}
