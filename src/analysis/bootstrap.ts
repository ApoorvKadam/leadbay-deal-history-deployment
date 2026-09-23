import type { CandidateSignal } from "../case/schema.js";
import type { NormalizedDeal } from "../ingestion/normalize-row.js";
import { AppError } from "../shared/errors.js";
import { evaluateCandidatePredicate } from "./predicates.js";

export interface BootstrapResult {
  samples: number;
  supportingSamples: number;
  undefinedSideSamples: number;
  directionStability: number;
}

export interface ClusteredBootstrapInput {
  deals: NormalizedDeal[];
  candidate: CandidateSignal;
  bootstrapSeed: number;
  samples: number;
  fullEffectPp: number;
}

function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function deriveBootstrapSeed(seed: number, candidateId: string): number {
  return hash32(`${seed >>> 0}:${candidateId.normalize("NFKC")}`);
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function sampleEffect(
  overallWins: number,
  overallRows: number,
  trueWins: number,
  trueRows: number,
  falseWins: number,
  falseRows: number,
): number {
  if (overallRows === 0) return Number.NaN;
  const pAll = overallWins / overallRows;
  const pTrue = (trueWins + 4 * pAll) / (trueRows + 4);
  const pFalse = (falseWins + 4 * pAll) / (falseRows + 4);
  return 100 * (pTrue - pFalse);
}

export function clusteredBootstrapStability(input: ClusteredBootstrapInput): BootstrapResult {
  const grouped = new Map<string, NormalizedDeal[]>();
  for (const deal of input.deals) {
    const rows = grouped.get(deal.companyIdentityGroupId) ?? [];
    rows.push(deal);
    grouped.set(deal.companyIdentityGroupId, rows);
  }
  const groups = [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, deals]) => deals);
  if (groups.length === 0 || input.samples <= 0) {
    return {
      samples: Math.max(0, input.samples),
      supportingSamples: 0,
      undefinedSideSamples: Math.max(0, input.samples),
      directionStability: 0,
    };
  }

  const random = mulberry32(deriveBootstrapSeed(input.bootstrapSeed, input.candidate.id));
  const fullSign = Math.sign(input.fullEffectPp);
  let supportingSamples = 0;
  let undefinedSideSamples = 0;
  for (let sampleIndex = 0; sampleIndex < input.samples; sampleIndex++) {
    const sampled: NormalizedDeal[] = [];
    for (let draw = 0; draw < groups.length; draw++) {
      const groupIndex = Math.floor(random() * groups.length);
      const group = groups.at(groupIndex);
      if (group === undefined) {
        throw new AppError({
          code: "BOOTSTRAP_GROUP_INDEX_INVALID",
          exitCode: 5,
          message: `Bootstrap group index ${groupIndex} is unavailable.`,
          hint: "Rerun the deterministic bootstrap; this indicates an internal sampling defect.",
        });
      }
      sampled.push(...group);
    }
    let trueRows = 0;
    let falseRows = 0;
    let trueWins = 0;
    let falseWins = 0;
    let overallWins = 0;
    for (const deal of sampled) {
      if (deal.outcome === "positive") overallWins++;
      const state = evaluateCandidatePredicate(deal, input.candidate);
      if (state === true) {
        trueRows++;
        if (deal.outcome === "positive") trueWins++;
      } else if (state === false) {
        falseRows++;
        if (deal.outcome === "positive") falseWins++;
      }
    }
    if (trueRows === 0 || falseRows === 0) {
      undefinedSideSamples++;
      continue;
    }
    const effect = sampleEffect(
      overallWins,
      sampled.length,
      trueWins,
      trueRows,
      falseWins,
      falseRows,
    );
    if (Math.sign(effect) === fullSign && Math.abs(effect) >= 8) supportingSamples++;
  }
  return {
    samples: input.samples,
    supportingSamples,
    undefinedSideSamples,
    directionStability: supportingSamples / input.samples,
  };
}
