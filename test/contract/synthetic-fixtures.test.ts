import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSyntheticCase } from "../../scripts/generate-synthetic-case.js";
import { loadCase } from "../../src/case/load-case.js";
import { AppError } from "../../src/shared/errors.js";

const caseDir = join(process.cwd(), "fixtures", "building-materials-distributor");
const conflictDir = join(process.cwd(), "test", "fixtures", "conflicting-deal-id");

describe("deterministic synthetic deployment case", () => {
  it("matches the deterministic generator without fixture drift", () => {
    expect(checkSyntheticCase(caseDir)).toEqual([]);
  });

  it("loads eighty labeled deals after collapsing one exact duplicate export", () => {
    const loaded = loadCase(caseDir);
    expect(loaded.ingestion.deals).toHaveLength(80);
    expect(loaded.ingestion.diagnostics.exact_duplicate_rows_collapsed).toBe(1);
    const positives = loaded.ingestion.deals.filter((deal) => deal.outcome === "positive");
    const negatives = loaded.ingestion.deals.filter((deal) => deal.outcome === "negative");
    expect(positives.length).toBeGreaterThanOrEqual(12);
    expect(negatives.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps repeat opportunities separate while assigning one company group", () => {
    const loaded = loadCase(caseDir);
    const groups = new Map<string, string[]>();
    for (const deal of loaded.ingestion.deals) {
      const ids = groups.get(deal.companyIdentityGroupId) ?? [];
      ids.push(deal.sourceRecordId);
      groups.set(deal.companyIdentityGroupId, ids);
    }
    expect([...groups.values()].some((ids) => ids.length > 1)).toBe(true);
    expect(groups.size).toBeGreaterThanOrEqual(70);
  });

  it("contains the five review prospect scenarios and canonical Leadbay state", () => {
    const loaded = loadCase(caseDir);
    const ids = loaded.ingestion.prospects.map((prospect) => prospect.sourceRecordId);
    for (const id of ["P-STRONG", "P-PARTIAL", "P-CONSUMER", "P-WEAK", "P-INACTIVE"]) {
      expect(ids).toContain(id);
    }
    expect(loaded.state.qualification_questions).toHaveLength(2);
    expect(loaded.state.ideal_buyer_profile?.anti_patterns).toHaveLength(1);
  });

  it("contains no historical win matching the inactive-company veto", () => {
    const loaded = loadCase(caseDir);
    const vetoedWins = loaded.ingestion.deals.filter(
      (deal) => deal.outcome === "positive" && deal.fields["Legal Status"] !== "active",
    );
    expect(vetoedWins).toHaveLength(0);
  });

  it("keeps the deliberate conflicting-ID failure case fail-closed", () => {
    let error: unknown;
    try {
      loadCase(conflictDir);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof AppError).toBe(true);
    expect((error as AppError).code).toBe("DEAL_ID_CONFLICT");
  });
});
