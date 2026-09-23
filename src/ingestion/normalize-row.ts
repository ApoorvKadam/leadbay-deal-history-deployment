import type { CustomerBrief, PredicateKind } from "../case/schema.js";
import { AppError } from "../shared/errors.js";
import { canonicalizeWebsite, deriveBusinessDomain } from "./domains.js";
import type { ParsedCsvRow } from "./parse-csv.js";

export type DomainSource = "website" | "business_email" | "none";
export type NormalizedValue = string | number | boolean | null;

export interface NormalizedDeal {
  sourceRowNumbers: number[];
  sourceRecordId: string;
  companyIdentityGroupId: string;
  originalCompanyName: string;
  normalizedCompanyName: string;
  normalizedLocation: string | null;
  canonicalDomain: string | null;
  domainSource: DomainSource;
  closeDate: string;
  outcome: "positive" | "negative" | null;
  fields: Record<string, NormalizedValue>;
  warnings: string[];
}

export interface NormalizedProspect {
  sourceRowNumbers: number[];
  sourceRecordId: string;
  companyIdentityGroupId: string;
  originalCompanyName: string;
  normalizedCompanyName: string;
  normalizedLocation: string | null;
  canonicalDomain: string | null;
  domainSource: DomainSource;
  fields: Record<string, NormalizedValue>;
  warnings: string[];
}

type PrimitiveParser = "number" | "boolean" | "string";

export function normalizeDisplayText(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeComparisonText(raw: string | null | undefined): string {
  return normalizeDisplayText(raw).toLocaleLowerCase("en-US");
}

function parserClass(kind: PredicateKind): PrimitiveParser {
  if (kind === "boolean_is") return "boolean";
  if (kind.startsWith("numeric_")) return "number";
  return "string";
}

export function buildConfiguredFieldParsers(brief: CustomerBrief): Map<string, PrimitiveParser> {
  const parsers = new Map<string, PrimitiveParser>();
  for (const rule of [...brief.candidate_signals, ...brief.explicit_vetoes]) {
    parsers.set(rule.source_column, parserClass(rule.kind));
  }
  if (brief.columns.loss_reason) parsers.set(brief.columns.loss_reason, "string");
  return parsers;
}

function parseConfiguredValue(
  raw: string | undefined,
  parser: PrimitiveParser,
  column: string,
  warnings: string[],
): NormalizedValue {
  const display = normalizeDisplayText(raw);
  if (display === "") return null;
  if (parser === "string") return display.toLocaleLowerCase("en-US");
  if (parser === "number") {
    const value = Number(display);
    if (Number.isFinite(value)) return value;
    warnings.push(`${column} must be a finite number; preserved as unknown.`);
    return null;
  }
  const normalized = display.toLocaleLowerCase("en-US");
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  warnings.push(`${column} must use true/false/yes/no/1/0; preserved as unknown.`);
  return null;
}

function requiredCell(row: ParsedCsvRow, column: string, code: string, label: string): string {
  const value = normalizeDisplayText(row.values[column]);
  if (value === "") {
    throw new AppError({
      code,
      exitCode: 2,
      message: `${label} is missing on source row ${row.sourceRowNumber}.`,
      hint: `Populate ${column} before analysis; the tool will not invent a stable identifier.`,
      details: { source_row: row.sourceRowNumber, column },
    });
  }
  return value;
}

function normalizeDate(row: ParsedCsvRow, column: string): string {
  const raw = requiredCell(row, column, "DEAL_DATE_MISSING", "Deal close date");
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    throw new AppError({
      code: "DEAL_DATE_INVALID",
      exitCode: 2,
      message: `Deal close date is not parseable on source row ${row.sourceRowNumber}.`,
      hint: `Use a real date in ${column}; ISO YYYY-MM-DD is preferred.`,
      details: { source_row: row.sourceRowNumber, column, value: raw },
    });
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeIdentity(
  row: ParsedCsvRow,
  brief: CustomerBrief,
  warnings: string[],
): Omit<
  NormalizedProspect,
  "sourceRowNumbers" | "sourceRecordId" | "companyIdentityGroupId" | "fields" | "warnings"
> {
  const originalCompanyName = normalizeDisplayText(row.values[brief.columns.company_name]);
  const normalizedCompanyName = originalCompanyName.toLocaleLowerCase("en-US");
  const normalizedLocation = brief.columns.location
    ? normalizeComparisonText(row.values[brief.columns.location]) || null
    : null;

  let canonicalDomain: string | null = null;
  let domainSource: DomainSource = "none";
  if (brief.columns.website) {
    const rawWebsite = normalizeDisplayText(row.values[brief.columns.website]);
    if (rawWebsite) {
      canonicalDomain = canonicalizeWebsite(rawWebsite);
      if (canonicalDomain) domainSource = "website";
      else warnings.push(`${brief.columns.website} is not a usable public web domain.`);
    }
  }
  if (!canonicalDomain && brief.columns.contact_email) {
    const rawEmail = row.values[brief.columns.contact_email];
    const derived = deriveBusinessDomain(rawEmail);
    if (derived.domain) {
      canonicalDomain = derived.domain;
      domainSource = "business_email";
    } else if (derived.rejectedConsumer) {
      warnings.push(
        `${brief.columns.contact_email} uses a consumer mailbox domain; no company domain was derived.`,
      );
    } else if (normalizeDisplayText(rawEmail)) {
      warnings.push(`${brief.columns.contact_email} is not a usable business email domain.`);
    }
  }
  return {
    originalCompanyName,
    normalizedCompanyName,
    normalizedLocation,
    canonicalDomain,
    domainSource,
  };
}

function normalizeFields(
  row: ParsedCsvRow,
  brief: CustomerBrief,
  warnings: string[],
): Record<string, NormalizedValue> {
  return Object.fromEntries(
    [...buildConfiguredFieldParsers(brief)].map(([column, parser]) => [
      column,
      parseConfiguredValue(row.values[column], parser, column, warnings),
    ]),
  );
}

function mapOutcome(
  raw: string | undefined,
  brief: CustomerBrief,
  warnings: string[],
): "positive" | "negative" | null {
  const value = normalizeComparisonText(raw);
  if (!value) return null;
  const positive = new Set(brief.business_goal.positive_outcomes.map(normalizeComparisonText));
  const negative = new Set(brief.business_goal.negative_outcomes.map(normalizeComparisonText));
  if (positive.has(value)) return "positive";
  if (negative.has(value)) return "negative";
  warnings.push(
    `${brief.columns.outcome} value "${normalizeDisplayText(raw)}" is not a configured outcome and remains unlabeled.`,
  );
  return null;
}

export function normalizeDealRows(rows: ParsedCsvRow[], brief: CustomerBrief): NormalizedDeal[] {
  return rows.map((row) => {
    const warnings: string[] = [];
    const sourceRecordId = requiredCell(
      row,
      brief.columns.record_id,
      "DEAL_ID_MISSING",
      "Deal record ID",
    );
    const identity = normalizeIdentity(row, brief, warnings);
    return {
      sourceRowNumbers: [row.sourceRowNumber],
      sourceRecordId,
      companyIdentityGroupId: "",
      ...identity,
      closeDate: normalizeDate(row, brief.columns.closed_at),
      outcome: mapOutcome(row.values[brief.columns.outcome], brief, warnings),
      fields: normalizeFields(row, brief, warnings),
      warnings,
    };
  });
}

export function normalizeProspectRows(
  rows: ParsedCsvRow[],
  brief: CustomerBrief,
): NormalizedProspect[] {
  return rows.map((row) => {
    const warnings: string[] = [];
    const sourceRecordId = requiredCell(
      row,
      brief.columns.record_id,
      "PROSPECT_ID_MISSING",
      "Prospect record ID",
    );
    return {
      sourceRowNumbers: [row.sourceRowNumber],
      sourceRecordId,
      companyIdentityGroupId: "",
      ...normalizeIdentity(row, brief, warnings),
      fields: normalizeFields(row, brief, warnings),
      warnings,
    };
  });
}
