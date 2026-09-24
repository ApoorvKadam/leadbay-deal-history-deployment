import type { CandidateSignal, ExplicitVeto, PredicateKind } from "../case/schema.js";
import type {
  NormalizedDeal,
  NormalizedProspect,
  NormalizedValue,
} from "../ingestion/normalize-row.js";

export type TriState = true | false | "unknown";
type FieldCarrier = Pick<NormalizedDeal | NormalizedProspect, "fields">;

interface PredicateDefinition {
  kind: PredicateKind;
  values?: string[];
  booleanValue?: boolean;
  threshold?: number;
  min?: number;
  max?: number;
}

function normalizedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return normalized === "" ? null : normalized;
}

function tokenText(value: string): string {
  return ` ${value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")} `;
}

function evaluate(value: NormalizedValue | undefined, predicate: PredicateDefinition): TriState {
  if (value === null || value === undefined) return "unknown";
  if (predicate.kind === "value_present") {
    if (typeof value === "string" && normalizedText(value) === null) return "unknown";
    if (typeof value === "number" && !Number.isFinite(value)) return "unknown";
    return true;
  }
  if (predicate.kind === "boolean_is") {
    return typeof value === "boolean" && predicate.booleanValue !== undefined
      ? value === predicate.booleanValue
      : "unknown";
  }
  if (predicate.kind === "categorical_in") {
    const text = normalizedText(value);
    if (text === null) return "unknown";
    const allowed = new Set(
      (predicate.values ?? []).map((item) => normalizedText(item)).filter(Boolean),
    );
    return allowed.has(text);
  }
  if (predicate.kind === "contains_any") {
    const text = normalizedText(value);
    if (text === null) return "unknown";
    const haystack = tokenText(text);
    return (predicate.values ?? []).some((phrase) => {
      const needle = tokenText(phrase);
      return needle.trim() !== "" && haystack.includes(needle);
    });
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (predicate.kind === "numeric_gte")
    return value >= (predicate.threshold ?? Number.POSITIVE_INFINITY);
  if (predicate.kind === "numeric_lte")
    return value <= (predicate.threshold ?? Number.NEGATIVE_INFINITY);
  if (predicate.kind === "numeric_between") {
    return (
      value >= (predicate.min ?? Number.POSITIVE_INFINITY) &&
      value <= (predicate.max ?? Number.NEGATIVE_INFINITY)
    );
  }
  return "unknown";
}

export function evaluateCandidatePredicate(
  row: FieldCarrier,
  candidate: CandidateSignal,
): TriState {
  const predicate: PredicateDefinition = { kind: candidate.kind };
  switch (candidate.kind) {
    case "boolean_is":
      predicate.booleanValue = candidate.favorable_value;
      break;
    case "categorical_in":
    case "contains_any":
      predicate.values = candidate.favorable_values;
      break;
    case "numeric_gte":
    case "numeric_lte":
      predicate.threshold = candidate.threshold;
      break;
    case "numeric_between":
      predicate.min = candidate.min;
      predicate.max = candidate.max;
      break;
    case "value_present":
      break;
  }
  return evaluate(row.fields[candidate.source_column], predicate);
}

export function evaluateVetoPredicate(row: FieldCarrier, veto: ExplicitVeto): TriState {
  const predicate: PredicateDefinition = { kind: veto.kind };
  switch (veto.kind) {
    case "boolean_is":
      predicate.booleanValue = veto.blocking_value;
      break;
    case "categorical_in":
    case "contains_any":
      predicate.values = veto.blocking_values;
      break;
    case "numeric_gte":
    case "numeric_lte":
      predicate.threshold = veto.threshold;
      break;
    case "numeric_between":
      predicate.min = veto.min;
      predicate.max = veto.max;
      break;
    case "value_present":
      break;
  }
  return evaluate(row.fields[veto.source_column], predicate);
}
