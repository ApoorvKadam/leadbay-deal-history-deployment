import { describe, expect, it } from "vitest";
import { deduplicateAndGroupDeals } from "../../../src/ingestion/deduplicate.js";
import type { NormalizedDeal } from "../../../src/ingestion/normalize-row.js";
import { AppError } from "../../../src/shared/errors.js";

function deal(overrides: Partial<NormalizedDeal> = {}): NormalizedDeal {
  return {
    sourceRowNumbers: [2],
    sourceRecordId: "D-1",
    companyIdentityGroupId: "",
    originalCompanyName: "Acme Supply",
    normalizedCompanyName: "acme supply",
    normalizedLocation: "dallas",
    canonicalDomain: "acme.example",
    domainSource: "website",
    closeDate: "2026-01-01",
    outcome: "positive",
    fields: { Revenue: 100, Active: true },
    warnings: [],
    ...overrides,
  };
}

describe("deduplicateAndGroupDeals", () => {
  it("collapses exact duplicate exports while retaining every source row", () => {
    const result = deduplicateAndGroupDeals([
      deal({ sourceRowNumbers: [2] }),
      deal({ sourceRowNumbers: [7], warnings: ["duplicate export warning"] }),
    ]);
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]?.sourceRowNumbers).toEqual([2, 7]);
    expect(result.exactDuplicateRowsCollapsed).toBe(1);
    expect(result.deals[0]?.companyIdentityGroupId).toBe("domain:acme.example");
  });

  it("fails rather than choosing between conflicting outcomes for one deal ID", () => {
    let error: unknown;
    try {
      deduplicateAndGroupDeals([deal(), deal({ sourceRowNumbers: [3], outcome: "negative" })]);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof AppError).toBe(true);
    expect((error as AppError).code).toBe("DEAL_ID_CONFLICT");
    expect((error as AppError).exitCode).toBe(2);
    expect((error as AppError).details).toEqual({ record_id: "D-1", source_rows: [2, 3] });
  });

  it("keeps separate opportunities but groups them by canonical domain", () => {
    const result = deduplicateAndGroupDeals([
      deal({ sourceRecordId: "D-1" }),
      deal({ sourceRecordId: "D-2", sourceRowNumbers: [3], closeDate: "2026-02-01" }),
    ]);
    expect(result.deals).toHaveLength(2);
    expect(result.deals[0]?.companyIdentityGroupId).toBe("domain:acme.example");
    expect(result.deals[1]?.companyIdentityGroupId).toBe("domain:acme.example");
  });

  it("falls back to normalized name plus location and then deal id", () => {
    const result = deduplicateAndGroupDeals([
      deal({ sourceRecordId: "D-3", canonicalDomain: null, domainSource: "none" }),
      deal({
        sourceRecordId: "D-4",
        sourceRowNumbers: [3],
        canonicalDomain: null,
        domainSource: "none",
        normalizedCompanyName: "",
        normalizedLocation: null,
      }),
    ]);
    expect(result.deals[0]?.companyIdentityGroupId).toBe("name-location:acme supply|dallas");
    expect(result.deals[1]?.companyIdentityGroupId).toBe("deal:D-4");
  });
});
