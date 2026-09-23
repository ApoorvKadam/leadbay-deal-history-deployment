import { describe, expect, it } from "vitest";
import {
  clusteredBootstrapStability,
  deriveBootstrapSeed,
} from "../../../src/analysis/bootstrap.js";
import type { CandidateSignal } from "../../../src/case/schema.js";
import type { NormalizedDeal } from "../../../src/ingestion/normalize-row.js";

const candidate: CandidateSignal = {
  id: "warehouse_density",
  source_column: "Warehouse Network",
  kind: "boolean_is",
  favorable_value: true,
  publicly_observable: true,
  question: "Is the company likely to operate a dense warehouse or depot network?",
};

function deal(
  id: string,
  group: string,
  outcome: "positive" | "negative",
  flag: boolean,
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
    closeDate: "2025-01-01",
    outcome,
    fields: { "Warehouse Network": flag },
    warnings: [],
  };
}

function concentratedDeals(): NormalizedDeal[] {
  return [
    ...Array.from({ length: 10 }, (_, index) => deal(`W-${index}`, "warehouse", "positive", true)),
    ...Array.from({ length: 20 }, (_, index) =>
      deal(`S-${index}`, `single-${index}`, index < 5 ? "positive" : "negative", false),
    ),
  ];
}

describe("clusteredBootstrapStability", () => {
  it("is byte-deterministic for one seed and candidate", () => {
    const input = {
      deals: concentratedDeals(),
      candidate,
      bootstrapSeed: 20260922,
      samples: 200,
      fullEffectPp: 50,
    };
    expect(clusteredBootstrapStability(input)).toEqual(clusteredBootstrapStability(input));
  });

  it("derives independent streams from candidate ids", () => {
    expect(deriveBootstrapSeed(20260922, "warehouse_density")).not.toBe(
      deriveBootstrapSeed(20260922, "field_sales"),
    );
  });

  it("samples repeated deals as one company cluster and counts missing sides as unsupported", () => {
    const result = clusteredBootstrapStability({
      deals: concentratedDeals(),
      candidate,
      bootstrapSeed: 20260922,
      samples: 500,
      fullEffectPp: 50,
    });
    expect(result.undefinedSideSamples).toBeGreaterThan(0);
    expect(result.directionStability).toBeLessThan(0.7);
    expect(result.supportingSamples + result.undefinedSideSamples).toBeLessThanOrEqual(
      result.samples,
    );
  });
});
