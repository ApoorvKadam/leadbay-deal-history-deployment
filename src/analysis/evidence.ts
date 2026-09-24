import type { CandidateSignal } from "../case/schema.js";
import type { NormalizedDeal } from "../ingestion/normalize-row.js";
import { AppError } from "../shared/errors.js";
import { type BootstrapResult, clusteredBootstrapStability } from "./bootstrap.js";
import { evaluateCandidatePredicate } from "./predicates.js";

export type EvidenceClassification =
  | "prohibited"
  | "not_publicly_observable"
  | "high_missingness"
  | "outcome_dependent_missingness"
  | "low_support"
  | "contradicted"
  | "unstable"
  | "eligible"
  | "weak_effect";

export interface SmoothedEffectInput {
  overallWins: number;
  overallRows: number;
  trueWins: number;
  trueRows: number;
  falseWins: number;
  falseRows: number;
}

export interface SmoothedEffect {
  pAll: number;
  pTrue: number;
  pFalse: number;
  effectPp: number;
}

export interface EvidenceGateInput {
  prohibited: boolean;
  publiclyObservable: boolean;
  knownCoverage: number;
  missingnessGapPp: number;
  trueRows: number;
  falseRows: number;
  supportThreshold: number;
  effectPp: number;
  directionStability: number;
}

export interface CandidateEvidence {
  candidateId: string;
  sourceColumn: string;
  question: string;
  classification: EvidenceClassification;
  overallRows: number;
  overallWins: number;
  knownRows: number;
  trueRows: number;
  falseRows: number;
  missingRows: number;
  trueWins: number;
  falseWins: number;
  knownCoverage: number;
  winMissingness: number;
  lossMissingness: number;
  missingnessGapPp: number;
  supportThreshold: number;
  pAll: number;
  pTrue: number;
  pFalse: number;
  effectPp: number;
  bootstrap: BootstrapResult;
  directionStability: number;
  priority: number;
}

export interface DeriveEvidenceOptions {
  bootstrapSeed: number;
  bootstrapSamples: number;
  minimumLabeledDeals: number;
  minimumClassCount: number;
  prohibitedColumns: string[];
}

export function calculateSmoothedEffect(input: SmoothedEffectInput): SmoothedEffect {
  const pAll = input.overallRows === 0 ? 0 : input.overallWins / input.overallRows;
  const pTrue = (input.trueWins + 4 * pAll) / (input.trueRows + 4);
  const pFalse = (input.falseWins + 4 * pAll) / (input.falseRows + 4);
  return { pAll, pTrue, pFalse, effectPp: 100 * (pTrue - pFalse) };
}

export function classifyEvidence(input: EvidenceGateInput): EvidenceClassification {
  if (input.prohibited) return "prohibited";
  if (!input.publiclyObservable) return "not_publicly_observable";
  if (input.knownCoverage < 0.65) return "high_missingness";
  if (input.missingnessGapPp > 20) return "outcome_dependent_missingness";
  if (input.trueRows < input.supportThreshold || input.falseRows < input.supportThreshold) {
    return "low_support";
  }
  if (input.effectPp <= -12) return "contradicted";
  if (input.effectPp >= 12 && input.directionStability < 0.7) return "unstable";
  if (input.effectPp >= 12 && input.directionStability >= 0.7) return "eligible";
  return "weak_effect";
}

function globalEvidenceGates(
  deals: NormalizedDeal[],
  options: DeriveEvidenceOptions,
): NormalizedDeal[] {
  const labeled = deals.filter(
    (deal): deal is NormalizedDeal & { outcome: "positive" | "negative" } => deal.outcome !== null,
  );
  if (labeled.length < options.minimumLabeledDeals) {
    throw new AppError({
      code: "LABELED_DEALS_TOO_SMALL",
      exitCode: 3,
      message: `Only ${labeled.length} labeled deals are available; ${options.minimumLabeledDeals} are required.`,
      hint: "Provide more stable won/lost history before deriving a deployable policy.",
      details: {
        labeled_deals: labeled.length,
        minimum_labeled_deals: options.minimumLabeledDeals,
      },
    });
  }
  const positive = labeled.filter((deal) => deal.outcome === "positive").length;
  const negative = labeled.length - positive;
  if (positive < options.minimumClassCount || negative < options.minimumClassCount) {
    throw new AppError({
      code: "TRAINING_CLASS_TOO_SMALL",
      exitCode: 3,
      message: "Training data does not contain enough positive and negative outcomes.",
      hint: "Provide more examples from the underrepresented outcome before deriving evidence.",
      details: { positive, negative, minimum_per_class: options.minimumClassCount },
    });
  }
  return labeled;
}

export function deriveSignalEvidence(
  deals: NormalizedDeal[],
  candidates: CandidateSignal[],
  options: DeriveEvidenceOptions,
): CandidateEvidence[] {
  const labeled = globalEvidenceGates(deals, options);
  const overallRows = labeled.length;
  const overallWins = labeled.filter((deal) => deal.outcome === "positive").length;
  const overallLosses = overallRows - overallWins;
  const prohibited = new Set(
    options.prohibitedColumns.map((column) =>
      column.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    ),
  );

  return candidates
    .map((candidate): CandidateEvidence => {
      let trueRows = 0;
      let falseRows = 0;
      let missingRows = 0;
      let trueWins = 0;
      let falseWins = 0;
      let missingWins = 0;
      let missingLosses = 0;
      for (const deal of labeled) {
        const state = evaluateCandidatePredicate(deal, candidate);
        if (state === true) {
          trueRows++;
          if (deal.outcome === "positive") trueWins++;
        } else if (state === false) {
          falseRows++;
          if (deal.outcome === "positive") falseWins++;
        } else {
          missingRows++;
          if (deal.outcome === "positive") missingWins++;
          else missingLosses++;
        }
      }
      const knownRows = trueRows + falseRows;
      const knownCoverage = knownRows / overallRows;
      const winMissingness = overallWins === 0 ? 0 : missingWins / overallWins;
      const lossMissingness = overallLosses === 0 ? 0 : missingLosses / overallLosses;
      const missingnessGapPp = 100 * Math.abs(winMissingness - lossMissingness);
      const supportThreshold = Math.max(8, Math.ceil(0.15 * overallRows));
      const effect = calculateSmoothedEffect({
        overallWins,
        overallRows,
        trueWins,
        trueRows,
        falseWins,
        falseRows,
      });
      const bootstrap = clusteredBootstrapStability({
        deals: labeled,
        candidate,
        bootstrapSeed: options.bootstrapSeed,
        samples: options.bootstrapSamples,
        fullEffectPp: effect.effectPp,
      });
      const classification = classifyEvidence({
        prohibited: prohibited.has(
          candidate.source_column.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
        ),
        publiclyObservable: candidate.publicly_observable === true,
        knownCoverage,
        missingnessGapPp,
        trueRows,
        falseRows,
        supportThreshold,
        effectPp: effect.effectPp,
        directionStability: bootstrap.directionStability,
      });
      return {
        candidateId: candidate.id,
        sourceColumn: candidate.source_column,
        question: candidate.question,
        classification,
        overallRows,
        overallWins,
        knownRows,
        trueRows,
        falseRows,
        missingRows,
        trueWins,
        falseWins,
        knownCoverage,
        winMissingness,
        lossMissingness,
        missingnessGapPp,
        supportThreshold,
        ...effect,
        bootstrap,
        directionStability: bootstrap.directionStability,
        priority: effect.effectPp * Math.sqrt(knownCoverage) * bootstrap.directionStability,
      };
    })
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

export function sortEligibleEvidence(evidence: CandidateEvidence[]): CandidateEvidence[] {
  return evidence
    .filter((item) => item.classification === "eligible")
    .sort(
      (left, right) =>
        right.priority - left.priority || left.candidateId.localeCompare(right.candidateId),
    );
}
