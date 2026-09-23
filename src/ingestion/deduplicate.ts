import { AppError } from "../shared/errors.js";
import { stableStringify } from "../shared/stable-json.js";
import type { NormalizedDeal } from "./normalize-row.js";

export interface DeduplicationResult {
  deals: NormalizedDeal[];
  exactDuplicateRowsCollapsed: number;
  identityGroupCount: number;
}

function substantiveDeal(deal: NormalizedDeal): Record<string, unknown> {
  const {
    sourceRowNumbers: _sourceRowNumbers,
    warnings: _warnings,
    companyIdentityGroupId: _companyIdentityGroupId,
    ...substantive
  } = deal;
  return substantive;
}

function groupId(deal: NormalizedDeal): string {
  if (deal.canonicalDomain) return `domain:${deal.canonicalDomain}`;
  if (deal.normalizedCompanyName && deal.normalizedLocation) {
    return `name-location:${deal.normalizedCompanyName}|${deal.normalizedLocation}`;
  }
  return `deal:${deal.sourceRecordId}`;
}

export function deduplicateAndGroupDeals(input: NormalizedDeal[]): DeduplicationResult {
  const byRecordId = new Map<string, NormalizedDeal>();
  let exactDuplicateRowsCollapsed = 0;
  for (const deal of input) {
    const current = byRecordId.get(deal.sourceRecordId);
    if (!current) {
      byRecordId.set(deal.sourceRecordId, {
        ...deal,
        sourceRowNumbers: [...deal.sourceRowNumbers],
        warnings: [...deal.warnings],
      });
      continue;
    }
    if (stableStringify(substantiveDeal(current)) !== stableStringify(substantiveDeal(deal))) {
      const sourceRows = [...current.sourceRowNumbers, ...deal.sourceRowNumbers].sort(
        (a, b) => a - b,
      );
      throw new AppError({
        code: "DEAL_ID_CONFLICT",
        exitCode: 2,
        message: `Deal ID ${deal.sourceRecordId} has conflicting source rows.`,
        hint: "Resolve the duplicate CRM export rows before analysis; the tool will not choose one version.",
        details: { record_id: deal.sourceRecordId, source_rows: sourceRows },
      });
    }
    current.sourceRowNumbers = [...current.sourceRowNumbers, ...deal.sourceRowNumbers].sort(
      (a, b) => a - b,
    );
    current.warnings = [...new Set([...current.warnings, ...deal.warnings])].sort();
    exactDuplicateRowsCollapsed += deal.sourceRowNumbers.length;
  }

  const deals = [...byRecordId.values()].map((deal) => ({
    ...deal,
    companyIdentityGroupId: groupId(deal),
  }));
  return {
    deals,
    exactDuplicateRowsCollapsed,
    identityGroupCount: new Set(deals.map((deal) => deal.companyIdentityGroupId)).size,
  };
}
