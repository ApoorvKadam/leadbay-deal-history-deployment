import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import YAML from "yaml";
import { deduplicateAndGroupDeals } from "../ingestion/deduplicate.js";
import type { NormalizedDeal, NormalizedProspect } from "../ingestion/normalize-row.js";
import { normalizeDealRows, normalizeProspectRows } from "../ingestion/normalize-row.js";
import { parseCsvFile } from "../ingestion/parse-csv.js";
import { AppError } from "../shared/errors.js";
import {
  type CustomerBrief,
  CustomerBriefSchema,
  type ExpectedPolicy,
  ExpectedPolicySchema,
  type LeadbayState,
  LeadbayStateSchema,
} from "./schema.js";

export interface CasePaths {
  root: string;
  customerBrief: string;
  historicalDeals: string;
  currentProspects: string;
  leadbayState: string;
  expectedPolicy: string;
}

export interface LoadedCaseMetadata {
  paths: CasePaths;
  brief: CustomerBrief;
  state: LeadbayState;
  expectedPolicy: ExpectedPolicy;
}

export interface IngestionResult {
  deals: NormalizedDeal[];
  prospects: NormalizedProspect[];
  diagnostics: {
    historical_source_rows: number;
    normalized_deals: number;
    current_prospects: number;
    exact_duplicate_rows_collapsed: number;
    identity_groups: number;
    warning_count: number;
  };
}

export interface LoadedCase extends LoadedCaseMetadata {
  ingestion: IngestionResult;
}

const REQUIRED = {
  customerBrief: "customer-brief.yaml",
  historicalDeals: "historical-deals.csv",
  currentProspects: "current-prospects.csv",
  leadbayState: "leadbay-state.json",
  expectedPolicy: "expected-policy.json",
} as const;

function appError(
  code: string,
  message: string,
  hint: string,
  details?: unknown,
  cause?: unknown,
): AppError {
  return new AppError({
    code,
    exitCode: 2,
    message,
    hint,
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  });
}

export function resolveCasePaths(caseDir: string): CasePaths {
  let root: string;
  try {
    root = realpathSync(caseDir);
  } catch (error) {
    throw appError(
      "CASE_ROOT_MISSING",
      `Case directory does not exist: ${caseDir}`,
      "Provide an existing case directory.",
      { case_dir: caseDir },
      error,
    );
  }
  const resolved = { root } as CasePaths;
  for (const [key, fileName] of Object.entries(REQUIRED) as Array<
    [keyof typeof REQUIRED, string]
  >) {
    const candidate = join(root, fileName);
    if (!existsSync(candidate)) {
      throw appError(
        "CASE_FILE_MISSING",
        `Required case file is missing: ${fileName}`,
        `Add ${fileName} to the case directory.`,
        { file: fileName },
      );
    }
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch (error) {
      throw appError(
        "CASE_FILE_MISSING",
        `Required case file cannot be resolved: ${fileName}`,
        `Repair ${fileName} and retry.`,
        { file: fileName },
        error,
      );
    }
    if (!real.startsWith(`${root}${sep}`) || !isAbsolute(real)) {
      throw appError(
        "CASE_PATH_ESCAPE",
        `Required file resolves outside the case root: ${fileName}`,
        "Replace external symlinks with files contained inside the case directory.",
        { file: fileName, resolved_path: real },
      );
    }
    (resolved as unknown as Record<string, string>)[key] = real;
  }
  return resolved;
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw appError(
      "CASE_JSON_INVALID",
      `${label} is not valid JSON.`,
      `Repair ${label} and retry.`,
      { file: path },
      error,
    );
  }
}

export function loadCaseMetadata(caseDir: string): LoadedCaseMetadata {
  const paths = resolveCasePaths(caseDir);
  let briefRaw: unknown;
  try {
    const document = YAML.parseDocument(readFileSync(paths.customerBrief, "utf8"), {
      schema: "core",
    });
    const diagnostic = document.errors[0] ?? document.warnings[0];
    if (diagnostic) throw diagnostic;
    briefRaw = document.toJS();
  } catch (error) {
    throw appError(
      "CASE_YAML_INVALID",
      `CASE_YAML_INVALID: ${error instanceof Error ? error.message : "customer-brief.yaml is not valid safe YAML."}`,
      "Use core YAML values only; custom tags are disabled.",
      { file: paths.customerBrief },
      error,
    );
  }
  try {
    return {
      paths,
      brief: CustomerBriefSchema.parse(briefRaw),
      state: LeadbayStateSchema.parse(readJson(paths.leadbayState, "leadbay-state.json")),
      expectedPolicy: ExpectedPolicySchema.parse(
        readJson(paths.expectedPolicy, "expected-policy.json"),
      ),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw appError(
      "CASE_SCHEMA_INVALID",
      error instanceof Error ? error.message : String(error),
      "Correct the case file to match the versioned contract.",
      undefined,
      error,
    );
  }
}

function requiredHistoricalColumns(brief: CustomerBrief): string[] {
  return [
    brief.columns.record_id,
    brief.columns.company_name,
    brief.columns.outcome,
    brief.columns.closed_at,
    ...(brief.columns.website ? [brief.columns.website] : []),
    ...(brief.columns.contact_email ? [brief.columns.contact_email] : []),
    ...(brief.columns.location ? [brief.columns.location] : []),
    ...(brief.columns.loss_reason ? [brief.columns.loss_reason] : []),
    ...brief.candidate_signals.map((rule) => rule.source_column),
    ...brief.explicit_vetoes.map((rule) => rule.source_column),
  ];
}

function requiredProspectColumns(brief: CustomerBrief): string[] {
  return [
    brief.columns.record_id,
    brief.columns.company_name,
    ...(brief.columns.website ? [brief.columns.website] : []),
    ...(brief.columns.contact_email ? [brief.columns.contact_email] : []),
    ...(brief.columns.location ? [brief.columns.location] : []),
    ...brief.candidate_signals.map((rule) => rule.source_column),
    ...brief.explicit_vetoes.map((rule) => rule.source_column),
  ];
}

function assertColumns(headers: string[], required: string[], dataset: string): void {
  const available = new Set(headers);
  const missing = [...new Set(required)].filter((column) => !available.has(column));
  if (missing.length > 0) {
    throw appError(
      "CASE_COLUMN_MISSING",
      `${dataset} is missing configured column(s): ${missing.join(", ")}.`,
      "Add the configured columns to the CSV header or correct customer-brief.yaml.",
      { dataset, missing_columns: missing },
    );
  }
}

export function loadCase(caseDir: string): LoadedCase {
  const metadata = loadCaseMetadata(caseDir);
  if (metadata.expectedPolicy.case_id !== metadata.brief.case_id) {
    throw appError(
      "CASE_ID_MISMATCH",
      "expected-policy.json does not name the same case_id as customer-brief.yaml.",
      "Align the two review contracts before analysis.",
      {
        brief_case_id: metadata.brief.case_id,
        expected_policy_case_id: metadata.expectedPolicy.case_id,
      },
    );
  }
  const historical = parseCsvFile(metadata.paths.historicalDeals);
  const prospects = parseCsvFile(metadata.paths.currentProspects);
  assertColumns(
    historical.headers,
    requiredHistoricalColumns(metadata.brief),
    "historical-deals.csv",
  );
  assertColumns(
    prospects.headers,
    requiredProspectColumns(metadata.brief),
    "current-prospects.csv",
  );

  const normalizedDeals = normalizeDealRows(historical.rows, metadata.brief);
  const normalizedProspects = normalizeProspectRows(prospects.rows, metadata.brief).map(
    (prospect) => ({
      ...prospect,
      companyIdentityGroupId: prospect.canonicalDomain
        ? `domain:${prospect.canonicalDomain}`
        : prospect.normalizedCompanyName && prospect.normalizedLocation
          ? `name-location:${prospect.normalizedCompanyName}|${prospect.normalizedLocation}`
          : `deal:${prospect.sourceRecordId}`,
    }),
  );
  const deduplicated = deduplicateAndGroupDeals(normalizedDeals);
  const warningCount = [
    ...deduplicated.deals.flatMap((deal) => deal.warnings),
    ...normalizedProspects.flatMap((prospect) => prospect.warnings),
  ].length;
  return {
    ...metadata,
    ingestion: {
      deals: deduplicated.deals,
      prospects: normalizedProspects,
      diagnostics: {
        historical_source_rows: historical.rows.length,
        normalized_deals: deduplicated.deals.length,
        current_prospects: normalizedProspects.length,
        exact_duplicate_rows_collapsed: deduplicated.exactDuplicateRowsCollapsed,
        identity_groups: deduplicated.identityGroupCount,
        warning_count: warningCount,
      },
    },
  };
}
