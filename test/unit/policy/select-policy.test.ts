import { describe, expect, it } from "vitest";
import type { CandidateEvidence } from "../../../src/analysis/evidence.js";
import { loadCase } from "../../../src/case/load-case.js";
import type { CustomerBrief, LeadbayState } from "../../../src/case/schema.js";
import type { NormalizedDeal } from "../../../src/ingestion/normalize-row.js";
import { selectPolicy } from "../../../src/policy/select-policy.js";

function evidence(id: string, priority: number, question?: string): CandidateEvidence {
  return {
    candidateId: id,
    sourceColumn: id,
    question: question ?? `Is the company likely to match ${id.replaceAll("_", " ")}?`,
    classification: "eligible",
    overallRows: 60,
    overallWins: 30,
    knownRows: 60,
    trueRows: 20,
    falseRows: 40,
    missingRows: 0,
    trueWins: 15,
    falseWins: 15,
    knownCoverage: 1,
    winMissingness: 0,
    lossMissingness: 0,
    missingnessGapPp: 0,
    supportThreshold: 9,
    pAll: 0.5,
    pTrue: 0.7,
    pFalse: 0.4,
    effectPp: 30,
    bootstrap: {
      samples: 200,
      supportingSamples: 180,
      undefinedSideSamples: 0,
      directionStability: 0.9,
    },
    directionStability: 0.9,
    priority,
  };
}

function briefFor(ids: string[]): CustomerBrief {
  const loaded = loadCase("fixtures/building-materials-distributor");
  return {
    ...loaded.brief,
    candidate_signals: ids.map((id) => ({
      id,
      source_column: id,
      kind: "boolean_is" as const,
      favorable_value: true,
      publicly_observable: true as const,
      question: `Is the company likely to match ${id.replaceAll("_", " ")}?`,
    })),
    explicit_vetoes: [],
  };
}

function stateWithQuestions(count: number): LeadbayState {
  const loaded = loadCase("fixtures/building-materials-distributor");
  return {
    ...loaded.state,
    qualification_questions: Array.from({ length: count }, (_, index) => ({
      question: `Is the company likely to have existing dimension ${index}?`,
      lang: "en",
    })),
    ideal_buyer_profile: null,
    targeting_prompt: null,
  };
}

describe("selectPolicy", () => {
  it("selects at most the top three eligible signals when three slots are free", () => {
    const ids = ["one", "two", "three", "four"];
    const selection = selectPolicy({
      brief: briefFor(ids),
      state: stateWithQuestions(2),
      evidence: ids.map((id, index) => evidence(id, 100 - index)),
      deals: [],
    });
    expect(selection.questionAdditions.map((item) => item.candidateId)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(selection.reserveSignals).toMatchObject([{ candidateId: "four", reason: "slot_limit" }]);
    expect(selection.freeQuestionSlots).toBe(3);
  });

  it("with five existing questions selects none and exposes ranked swap candidates", () => {
    const ids = ["one", "two"];
    const selection = selectPolicy({
      brief: briefFor(ids),
      state: stateWithQuestions(5),
      evidence: [evidence("one", 20), evidence("two", 10)],
      deals: [],
    });
    expect(selection.questionAdditions).toHaveLength(0);
    expect(selection.swapCandidates.map((item) => item.candidateId)).toEqual(["one", "two"]);
    expect(selection.requiredHumanApprovals).toHaveLength(0);
    expect(JSON.stringify(selection)).not.toContain("remove");
  });

  it("reserves a duplicate proposal instead of rewriting existing configuration", () => {
    const brief = briefFor(["duplicate"]);
    brief.candidate_signals[0]!.question =
      "Is the company likely to have a dedicated commercial team?";
    const selection = selectPolicy({
      brief,
      state: loadCase("fixtures/building-materials-distributor").state,
      evidence: [
        evidence("duplicate", 50, "Is the company likely to have a dedicated commercial team?"),
      ],
      deals: [],
    });
    expect(selection.questionAdditions).toHaveLength(0);
    expect(selection.reserveSignals[0]).toMatchObject({
      candidateId: "duplicate",
      reason: "duplicate",
      duplicateSurface: "existing_question",
    });
  });

  it("keeps missing veto data unknown and never fabricates a match", () => {
    const loaded = loadCase("fixtures/building-materials-distributor");
    const win = loaded.ingestion.deals.find((deal) => deal.outcome === "positive")!;
    const unknownWin: NormalizedDeal = {
      ...win,
      fields: { ...win.fields, "Legal Status": null },
    };
    const selection = selectPolicy({
      brief: loaded.brief,
      state: loaded.state,
      evidence: [],
      deals: [unknownWin],
    });
    expect(selection.vetoedHistoricalWinIds).toHaveLength(0);
    expect(selection.deploymentBlocked).toBe(false);
  });

  it("blocks an unacknowledged historical-win veto tradeoff but preserves its brief source", () => {
    const loaded = loadCase("fixtures/building-materials-distributor");
    const win = loaded.ingestion.deals.find((deal) => deal.outcome === "positive")!;
    const vetoedWin: NormalizedDeal = {
      ...win,
      fields: { ...win.fields, "Legal Status": "inactive" },
    };
    const selection = selectPolicy({
      brief: loaded.brief,
      state: loaded.state,
      evidence: [],
      deals: [vetoedWin],
    });
    expect(selection.deploymentBlocked).toBe(true);
    expect(selection.vetoedHistoricalWinIds).toEqual([win.sourceRecordId]);
    expect(selection.antiPatternAdditions).toMatchObject([
      { vetoId: "inactive_company", source: "customer_brief" },
    ]);
  });

  it("still diagnoses vetoed wins when the anti-pattern is already configured", () => {
    const loaded = loadCase("fixtures/building-materials-distributor");
    const win = loaded.ingestion.deals.find((deal) => deal.outcome === "positive")!;
    const vetoedWin: NormalizedDeal = {
      ...win,
      fields: { ...win.fields, "Legal Status": "inactive" },
    };
    const state: LeadbayState = {
      ...loaded.state,
      ideal_buyer_profile: {
        summary: "Regional suppliers",
        key_characteristics: [],
        anti_patterns: ["Inactive dissolved or liquidated companies"],
      },
    };
    const selection = selectPolicy({
      brief: loaded.brief,
      state,
      evidence: [],
      deals: [vetoedWin],
    });
    expect(selection.deploymentBlocked).toBe(true);
    expect(selection.vetoedHistoricalWinIds).toEqual([win.sourceRecordId]);
    expect(selection.antiPatternAdditions).toHaveLength(0);
  });

  it("allows an explicitly acknowledged veto tradeoff", () => {
    const loaded = loadCase("fixtures/building-materials-distributor");
    const brief: CustomerBrief = {
      ...loaded.brief,
      explicit_vetoes: loaded.brief.explicit_vetoes.map((item) => ({
        ...item,
        historical_win_tradeoff_acknowledged: true,
      })),
    };
    const win = loaded.ingestion.deals.find((deal) => deal.outcome === "positive")!;
    const vetoedWin: NormalizedDeal = {
      ...win,
      fields: { ...win.fields, "Legal Status": "inactive" },
    };
    const selection = selectPolicy({
      brief,
      state: loaded.state,
      evidence: [],
      deals: [vetoedWin],
    });
    expect(selection.deploymentBlocked).toBe(false);
    expect(selection.antiPatternAdditions).toHaveLength(1);
  });
});
