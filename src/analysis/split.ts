import type { NormalizedDeal } from "../ingestion/normalize-row.js";
import { AppError } from "../shared/errors.js";

export type SplitPartition = "training" | "holdout";

export interface SplitOptions {
  holdoutFraction: number;
  minimumTrainingClassCount: number;
  minimumHoldoutClassCount: number;
}

export interface SplitMembership {
  trainingIds: string[];
  holdoutIds: string[];
  trainingDeals: NormalizedDeal[];
  holdoutDeals: NormalizedDeal[];
  actualHoldoutFraction: number;
  holdoutCutoffDate: string;
  membership: Record<string, SplitPartition>;
}

interface DealGroup {
  id: string;
  deals: NormalizedDeal[];
  latestCloseDate: string;
}

function classCounts(deals: NormalizedDeal[]): { positive: number; negative: number } {
  return {
    positive: deals.filter((deal) => deal.outcome === "positive").length,
    negative: deals.filter((deal) => deal.outcome === "negative").length,
  };
}

export function groupedTemporalSplit(
  input: NormalizedDeal[],
  options: SplitOptions,
): SplitMembership {
  const deals = input.filter(
    (deal): deal is NormalizedDeal & { outcome: "positive" | "negative" } => deal.outcome !== null,
  );
  if (deals.length === 0) {
    throw new AppError({
      code: "NO_LABELED_DEALS",
      exitCode: 3,
      message: "No labeled deals are available for a grouped temporal split.",
      hint: "Map positive and negative outcome values in customer-brief.yaml before analysis.",
    });
  }
  if (!(options.holdoutFraction > 0 && options.holdoutFraction < 1)) {
    throw new AppError({
      code: "HOLDOUT_FRACTION_INVALID",
      exitCode: 3,
      message: "Holdout fraction must be greater than zero and less than one.",
      hint: "Use the validated grouped_temporal holdout_fraction from customer-brief.yaml.",
      details: { holdout_fraction: options.holdoutFraction },
    });
  }

  const groupMap = new Map<string, NormalizedDeal[]>();
  for (const deal of deals) {
    const group = groupMap.get(deal.companyIdentityGroupId) ?? [];
    group.push(deal);
    groupMap.set(deal.companyIdentityGroupId, group);
  }
  const groups: DealGroup[] = [...groupMap].map(([id, groupDeals]) => {
    const firstDeal = groupDeals.at(0);
    if (firstDeal === undefined) {
      throw new AppError({
        code: "EMPTY_COMPANY_GROUP",
        exitCode: 5,
        message: `Company group ${id} unexpectedly contains no deals.`,
        hint: "Rerun normalization; this indicates an internal grouping defect.",
      });
    }
    return {
      id,
      deals: [...groupDeals].sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)),
      latestCloseDate: groupDeals.reduce(
        (latest, deal) => (deal.closeDate > latest ? deal.closeDate : latest),
        firstDeal.closeDate,
      ),
    };
  });
  groups.sort(
    (left, right) =>
      left.latestCloseDate.localeCompare(right.latestCloseDate) || left.id.localeCompare(right.id),
  );

  const holdoutGroupIds = new Set<string>();
  const targetRows = Math.ceil(deals.length * options.holdoutFraction);
  let holdoutRows = 0;
  for (let index = groups.length - 1; index >= 0 && holdoutRows < targetRows; index--) {
    const group = groups.at(index);
    if (group === undefined) {
      throw new AppError({
        code: "HOLDOUT_GROUP_INDEX_INVALID",
        exitCode: 5,
        message: `Holdout group index ${index} is unavailable.`,
        hint: "Rerun the grouped temporal split; this indicates an internal indexing defect.",
      });
    }
    holdoutGroupIds.add(group.id);
    holdoutRows += group.deals.length;
  }

  const trainingDeals = deals
    .filter((deal) => !holdoutGroupIds.has(deal.companyIdentityGroupId))
    .sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  const holdoutDeals = deals
    .filter((deal) => holdoutGroupIds.has(deal.companyIdentityGroupId))
    .sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  const holdoutCounts = classCounts(holdoutDeals);
  if (
    holdoutCounts.positive < options.minimumHoldoutClassCount ||
    holdoutCounts.negative < options.minimumHoldoutClassCount
  ) {
    throw new AppError({
      code: "HOLDOUT_CLASS_TOO_SMALL",
      exitCode: 3,
      message:
        "The grouped temporal holdout does not contain enough positive and negative outcomes.",
      hint: "Provide more labeled recent deals or lower the documented minimum only after a human methodology review.",
      details: {
        minimum_per_class: options.minimumHoldoutClassCount,
        positive: holdoutCounts.positive,
        negative: holdoutCounts.negative,
      },
    });
  }
  const trainingCounts = classCounts(trainingDeals);
  if (
    trainingCounts.positive < options.minimumTrainingClassCount ||
    trainingCounts.negative < options.minimumTrainingClassCount
  ) {
    throw new AppError({
      code: "TRAINING_CLASS_TOO_SMALL",
      exitCode: 3,
      message: "The training partition does not contain enough positive and negative outcomes.",
      hint: "Provide more older labeled deals before deriving qualification evidence.",
      details: {
        minimum_per_class: options.minimumTrainingClassCount,
        positive: trainingCounts.positive,
        negative: trainingCounts.negative,
      },
    });
  }

  const membership = Object.fromEntries(
    [
      ...trainingDeals.map((deal) => [deal.sourceRecordId, "training"] as const),
      ...holdoutDeals.map((deal) => [deal.sourceRecordId, "holdout"] as const),
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
  const holdoutGroups = groups.filter((group) => holdoutGroupIds.has(group.id));
  const firstHoldoutGroup = holdoutGroups.at(0);
  if (firstHoldoutGroup === undefined) {
    throw new AppError({
      code: "HOLDOUT_GROUP_MISSING",
      exitCode: 5,
      message: "The grouped temporal split produced no holdout company group.",
      hint: "Use a holdout fraction above zero and provide enough labeled company groups.",
    });
  }
  const holdoutCutoffDate = holdoutGroups.reduce(
    (earliest, group) => (group.latestCloseDate < earliest ? group.latestCloseDate : earliest),
    firstHoldoutGroup.latestCloseDate,
  );
  return {
    trainingIds: trainingDeals.map((deal) => deal.sourceRecordId),
    holdoutIds: holdoutDeals.map((deal) => deal.sourceRecordId),
    trainingDeals,
    holdoutDeals,
    actualHoldoutFraction: holdoutDeals.length / deals.length,
    holdoutCutoffDate,
    membership,
  };
}
