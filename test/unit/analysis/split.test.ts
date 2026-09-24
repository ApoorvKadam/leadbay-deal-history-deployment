import { describe, expect, it } from "vitest";
import { groupedTemporalSplit } from "../../../src/analysis/split.js";
import type { NormalizedDeal } from "../../../src/ingestion/normalize-row.js";
import { AppError } from "../../../src/shared/errors.js";

function deal(
  id: string,
  group: string,
  closeDate: string,
  outcome: "positive" | "negative",
): NormalizedDeal {
  return {
    sourceRowNumbers: [2],
    sourceRecordId: id,
    companyIdentityGroupId: group,
    originalCompanyName: group,
    normalizedCompanyName: group,
    normalizedLocation: "x",
    canonicalDomain: `${group}.example`,
    domainSource: "website",
    closeDate,
    outcome,
    fields: {},
    warnings: [],
  };
}

const deals = [
  deal("A-1", "a", "2025-01-01", "positive"),
  deal("B-1", "b", "2025-02-01", "negative"),
  deal("C-1", "c", "2025-03-01", "positive"),
  deal("D-1", "d", "2025-04-01", "negative"),
  deal("E-1", "e", "2025-05-01", "positive"),
  deal("F-1", "f", "2025-06-01", "negative"),
  deal("G-1", "g", "2025-07-01", "positive"),
  deal("G-2", "g", "2025-07-15", "negative"),
];

describe("groupedTemporalSplit", () => {
  it("is independent of CSV order and moves whole newest groups", () => {
    const first = groupedTemporalSplit(deals, {
      holdoutFraction: 0.25,
      minimumTrainingClassCount: 1,
      minimumHoldoutClassCount: 1,
    });
    const second = groupedTemporalSplit([...deals].reverse(), {
      holdoutFraction: 0.25,
      minimumTrainingClassCount: 1,
      minimumHoldoutClassCount: 1,
    });
    expect(first.membership).toEqual(second.membership);
    expect(first.holdoutIds).toEqual(["G-1", "G-2"]);
    expect(first.actualHoldoutFraction).toBe(0.25);
    expect(first.holdoutCutoffDate).toBe("2025-07-15");
    expect(first.membership["G-1"]).toBe("holdout");
    expect(first.membership["G-2"]).toBe("holdout");
  });

  it("may exceed the requested fraction rather than splitting a company group", () => {
    const result = groupedTemporalSplit(deals, {
      holdoutFraction: 0.1,
      minimumTrainingClassCount: 1,
      minimumHoldoutClassCount: 1,
    });
    expect(result.holdoutIds).toEqual(["G-1", "G-2"]);
    expect(result.actualHoldoutFraction).toBe(0.25);
    const partitionsByGroup = new Map<string, Set<string>>();
    for (const item of deals) {
      const partitions = partitionsByGroup.get(item.companyIdentityGroupId) ?? new Set<string>();
      partitions.add(result.membership[item.sourceRecordId]!);
      partitionsByGroup.set(item.companyIdentityGroupId, partitions);
    }
    expect([...partitionsByGroup.values()].every((parts) => parts.size === 1)).toBe(true);
  });

  it("rejects a holdout without the configured outcome classes", () => {
    const oneSidedNewest = [
      deal("A", "a", "2025-01-01", "positive"),
      deal("B", "b", "2025-02-01", "negative"),
      deal("C", "c", "2025-03-01", "positive"),
      deal("D", "d", "2025-04-01", "positive"),
    ];
    let error: unknown;
    try {
      groupedTemporalSplit(oneSidedNewest, {
        holdoutFraction: 0.25,
        minimumTrainingClassCount: 1,
        minimumHoldoutClassCount: 1,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof AppError).toBe(true);
    expect((error as AppError).code).toBe("HOLDOUT_CLASS_TOO_SMALL");
    expect((error as AppError).exitCode).toBe(3);
  });

  it("splits the committed synthetic case into sixty training and twenty holdout deals", async () => {
    const { loadCase } = await import("../../../src/case/load-case.js");
    const loaded = loadCase("fixtures/building-materials-distributor");
    const result = groupedTemporalSplit(loaded.ingestion.deals, {
      holdoutFraction: loaded.brief.analysis.holdout_fraction,
      minimumTrainingClassCount: loaded.brief.analysis.minimum_class_count,
      minimumHoldoutClassCount: loaded.brief.analysis.minimum_holdout_class_count,
    });
    expect(result.trainingIds).toHaveLength(60);
    expect(result.holdoutIds).toHaveLength(20);
  });
});
