import { describe, expect, it } from "vitest";
import {
  evaluateCandidatePredicate,
  evaluateVetoPredicate,
} from "../../../src/analysis/predicates.js";
import type { CandidateSignal, ExplicitVeto } from "../../../src/case/schema.js";

function candidate(overrides: Partial<CandidateSignal>): CandidateSignal {
  return {
    id: "candidate",
    source_column: "value",
    kind: "boolean_is",
    favorable_value: true,
    publicly_observable: true,
    question: "Is the company likely to match the tested business dimension?",
    ...overrides,
  } as CandidateSignal;
}

function veto(overrides: Partial<ExplicitVeto>): ExplicitVeto {
  return {
    id: "veto",
    source_column: "value",
    kind: "boolean_is",
    blocking_value: true,
    publicly_observable: true,
    anti_pattern: "Blocked companies",
    historical_win_tradeoff_acknowledged: false,
    ...overrides,
  } as ExplicitVeto;
}

const row = (value: unknown) => ({ fields: { value: value as never } });

describe("evaluateCandidatePredicate", () => {
  it("evaluates boolean_is with unknown preserved", () => {
    const rule = candidate({ kind: "boolean_is", favorable_value: true });
    expect(evaluateCandidatePredicate(row(true), rule)).toBe(true);
    expect(evaluateCandidatePredicate(row(false), rule)).toBe(false);
    expect(evaluateCandidatePredicate(row(null), rule)).toBe("unknown");
    expect(evaluateCandidatePredicate(row("yes"), rule)).toBe("unknown");
  });

  it("evaluates categorical_in case-insensitively", () => {
    const rule = candidate({
      kind: "categorical_in",
      favorable_values: ["Field Sales", "Territory Sales"],
    });
    expect(evaluateCandidatePredicate(row(" field sales "), rule)).toBe(true);
    expect(evaluateCandidatePredicate(row("inside sales"), rule)).toBe(false);
    expect(evaluateCandidatePredicate(row(""), rule)).toBe("unknown");
  });

  it("uses token-safe matching for contains_any", () => {
    const rule = candidate({ kind: "contains_any", favorable_values: ["CRM", "ERP export"] });
    expect(evaluateCandidatePredicate(row("HubSpot CRM and ERP export"), rule)).toBe(true);
    expect(evaluateCandidatePredicate(row("acrimonious procurement"), rule)).toBe(false);
    expect(evaluateCandidatePredicate(row(null), rule)).toBe("unknown");
  });

  it("evaluates numeric_gte without coercing invalid values", () => {
    const rule = candidate({ kind: "numeric_gte", threshold: 100 });
    expect(evaluateCandidatePredicate(row(100), rule)).toBe(true);
    expect(evaluateCandidatePredicate(row(99), rule)).toBe(false);
    expect(evaluateCandidatePredicate(row("100"), rule)).toBe("unknown");
    expect(evaluateCandidatePredicate(row(Number.NaN), rule)).toBe("unknown");
  });

  it("evaluates numeric_lte and inclusive numeric_between", () => {
    const lte = candidate({ kind: "numeric_lte", threshold: 50 });
    const between = candidate({ kind: "numeric_between", min: 10, max: 20 });
    expect(evaluateCandidatePredicate(row(50), lte)).toBe(true);
    expect(evaluateCandidatePredicate(row(51), lte)).toBe(false);
    expect(evaluateCandidatePredicate(row(null), lte)).toBe("unknown");
    expect(evaluateCandidatePredicate(row(10), between)).toBe(true);
    expect(evaluateCandidatePredicate(row(20), between)).toBe(true);
    expect(evaluateCandidatePredicate(row(21), between)).toBe(false);
    expect(evaluateCandidatePredicate(row(""), between)).toBe("unknown");
  });

  it("treats value_present as true or unknown, never a fabricated false", () => {
    const rule = candidate({ kind: "value_present" });
    expect(evaluateCandidatePredicate(row("funding round"), rule)).toBe(true);
    expect(evaluateCandidatePredicate(row(0), rule)).toBe(true);
    expect(evaluateCandidatePredicate(row(null), rule)).toBe("unknown");
    expect(evaluateCandidatePredicate(row("   "), rule)).toBe("unknown");
  });
});

describe("evaluateVetoPredicate", () => {
  it("shares the predicate engine but uses blocking values", () => {
    const categorical = veto({
      kind: "categorical_in",
      blocking_values: ["Inactive", "Liquidation"],
    });
    expect(evaluateVetoPredicate(row("inactive"), categorical)).toBe(true);
    expect(evaluateVetoPredicate(row("active"), categorical)).toBe(false);
    expect(evaluateVetoPredicate(row(null), categorical)).toBe("unknown");
  });
});
