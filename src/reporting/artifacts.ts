import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CandidateEvidence } from "../analysis/evidence.js";
import type { SplitMembership } from "../analysis/split.js";
import type { LoadedCase } from "../case/load-case.js";
import { type PolicyManifest, PolicyManifestSchema, type RuntimeSchema } from "../case/schema.js";
import type { HoldoutEvaluation } from "../evaluation/metrics.js";
import type { ScoredRecord } from "../evaluation/score-policy.js";
import type { NormalizedDeal } from "../ingestion/normalize-row.js";
import { AppError, asAppError } from "../shared/errors.js";
import { assertNoProductionHost, redactForArtifact } from "../shared/redaction.js";
import { stableStringify } from "../shared/stable-json.js";
import { type ReportMode, renderDeploymentReport, renderSummary } from "./markdown-report.js";

export const ANALYSIS_ARTIFACTS = [
  "run-metadata.json",
  "source-fingerprint.json",
  "data-quality.json",
  "data-quality.md",
  "normalized-deals.redacted.csv",
  "split-membership.json",
  "signal-evidence.json",
  "policy-manifest.json",
  "holdout-evaluation.json",
  "prospect-preview.csv",
  "deployment-report.md",
  "summary.txt",
] as const;

export const DEMO_ARTIFACTS = [
  "run-metadata.json",
  "source-fingerprint.json",
  "data-quality.json",
  "data-quality.md",
  "normalized-deals.redacted.csv",
  "split-membership.json",
  "signal-evidence.json",
  "policy-manifest.json",
  "holdout-evaluation.json",
  "prospect-preview.csv",
  "leadbay-mcp-trace.json",
  "mock-session-attestation.json",
  "leadbay-deployment-preview.json",
  "generated-mock-fixtures",
  "deployment-report.md",
  "summary.txt",
] as const;

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "string") {
    text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else {
    text = stableStringify(value).trimEnd();
  }
  if (text === "") return '""';
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const headers =
    columns ??
    [...new Set(rows.flatMap((row) => Object.keys(row)))].sort((a, b) => a.localeCompare(b));
  const lines = [headers.map(csvValue).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvValue(row[header])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export interface ArtifactWriterOptions {
  outputRoot: string;
  finalDir: string;
  caseId: string;
  runId: string;
}

export interface ArtifactFileOperations {
  exists(path: string): boolean;
  remove(path: string): void;
  rename(source: string, target: string): void;
}

const DEFAULT_FILE_OPERATIONS: ArtifactFileOperations = {
  exists: existsSync,
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  rename: renameSync,
};

export class ArtifactWriter {
  readonly outputRoot: string;
  readonly finalDir: string;
  readonly temporaryDir: string;
  readonly caseId: string;
  readonly runId: string;
  private readonly fileOperations: ArtifactFileOperations;
  private closed = false;

  private constructor(
    options: ArtifactWriterOptions,
    fileOperations: ArtifactFileOperations = DEFAULT_FILE_OPERATIONS,
  ) {
    this.outputRoot = resolve(options.outputRoot);
    this.finalDir = resolve(options.finalDir);
    this.caseId = options.caseId;
    this.runId = options.runId;
    this.fileOperations = fileOperations;
    if (!contained(this.outputRoot, this.finalDir)) {
      throw new AppError({
        code: "OUTPUT_PATH_ESCAPE",
        exitCode: 2,
        message: "The final artifact directory escapes the selected output root.",
        hint: "Choose a final output directory contained inside --out.",
        details: { output_root: this.outputRoot, final_dir: this.finalDir },
      });
    }
    mkdirSync(this.outputRoot, { recursive: true });
    this.temporaryDir = join(
      dirname(this.finalDir),
      `.${this.caseId}.${this.runId}.${randomUUID()}.tmp`,
    );
    mkdirSync(this.temporaryDir, { recursive: false });
  }

  static begin(
    options: ArtifactWriterOptions,
    fileOperations: ArtifactFileOperations = DEFAULT_FILE_OPERATIONS,
  ): ArtifactWriter {
    return new ArtifactWriter(options, fileOperations);
  }

  private destination(relativePath: string): string {
    if (this.closed) {
      throw new AppError({
        code: "ARTIFACT_WRITER_CLOSED",
        exitCode: 6,
        message: "The artifact writer is already closed.",
        hint: "Create a new writer for another run.",
      });
    }
    const target = resolve(this.temporaryDir, relativePath);
    if (!contained(this.temporaryDir, target)) {
      throw new AppError({
        code: "ARTIFACT_PATH_ESCAPE",
        exitCode: 6,
        message: `Artifact path escapes the run directory: ${relativePath}.`,
        hint: "Use a relative artifact name without parent traversal.",
        details: { artifact: relativePath },
      });
    }
    mkdirSync(dirname(target), { recursive: true });
    return target;
  }

  writeText(relativePath: string, text: string): void {
    assertNoProductionHost(text);
    writeFileSync(this.destination(relativePath), redactForArtifact(text), "utf8");
  }

  writeJson<T>(relativePath: string, value: T, schema?: RuntimeSchema<T>): void {
    const parsed = schema ? schema.parse(value) : value;
    assertNoProductionHost(parsed);
    writeFileSync(
      this.destination(relativePath),
      stableStringify(redactForArtifact(parsed)),
      "utf8",
    );
  }

  writeCsv(relativePath: string, rows: Array<Record<string, unknown>>, columns?: string[]): void {
    assertNoProductionHost(rows);
    const redacted = redactForArtifact(rows);
    writeFileSync(this.destination(relativePath), renderCsv(redacted, columns), "utf8");
  }

  private verifyInventory(required: readonly string[]): void {
    const missing = required.filter((item) => !existsSync(join(this.temporaryDir, item)));
    if (missing.length > 0) {
      throw new AppError({
        code: "ARTIFACT_INVENTORY_INCOMPLETE",
        exitCode: 6,
        message: `Artifact package is incomplete: ${missing.join(", ")}.`,
        hint: "Generate and validate every command-required artifact before committing the package.",
        details: { missing },
      });
    }
  }

  private assertExistingPackageOwned(): void {
    if (!this.fileOperations.exists(this.finalDir)) return;
    const metadataPath = join(this.finalDir, "run-metadata.json");
    let metadata: unknown;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    } catch (error) {
      throw new AppError({
        code: "OUTPUT_TARGET_NOT_OWNED",
        exitCode: 2,
        message: "The output target already exists but is not a recognized artifact package.",
        hint: "Choose an empty path, or a previous output directory created for this same case.",
        details: { final_dir: this.finalDir },
        cause: error,
      });
    }
    if (
      !metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      (metadata as Record<string, unknown>).schema_version !== "1.0" ||
      (metadata as Record<string, unknown>).scenario !== "synthetic" ||
      (metadata as Record<string, unknown>).case_id !== this.caseId
    ) {
      throw new AppError({
        code: "OUTPUT_TARGET_NOT_OWNED",
        exitCode: 2,
        message: "The output target already exists but is not a recognized artifact package.",
        hint: "Choose an empty path, or a previous output directory created for this same case.",
        details: { final_dir: this.finalDir },
      });
    }
  }

  commit(required: readonly string[]): string {
    this.verifyInventory(required);
    this.assertExistingPackageOwned();
    const backup = join(
      dirname(this.finalDir),
      `.${basename(this.finalDir)}.${this.runId}.${randomUUID()}.backup`,
    );
    let priorPackageStaged = false;
    try {
      if (this.fileOperations.exists(this.finalDir)) {
        this.fileOperations.rename(this.finalDir, backup);
        priorPackageStaged = true;
      }
      this.fileOperations.rename(this.temporaryDir, this.finalDir);
      this.closed = true;
    } catch (error) {
      if (priorPackageStaged) {
        try {
          if (this.fileOperations.exists(this.finalDir)) {
            throw new Error("Replacement target exists after failed atomic rename.");
          }
          this.fileOperations.rename(backup, this.finalDir);
        } catch (restoreError) {
          throw new AppError({
            code: "ARTIFACT_COMMIT_ROLLBACK_FAILED",
            exitCode: 6,
            message: "The new artifact package failed and the prior package could not be restored.",
            hint: "Inspect the output directory and its sibling .backup directory before retrying.",
            details: { final_dir: this.finalDir, backup_dir: backup },
            cause: new AggregateError([error, restoreError]),
          });
        }
      }
      throw new AppError({
        code: "ARTIFACT_COMMIT_FAILED",
        exitCode: 6,
        message: "The artifact package could not replace the prior package atomically.",
        hint: "The prior package was preserved. Inspect filesystem permissions and retry.",
        details: { final_dir: this.finalDir },
        cause: error,
      });
    }
    if (priorPackageStaged && this.fileOperations.exists(backup)) {
      try {
        this.fileOperations.remove(backup);
      } catch {
        // The committed package is complete. A stale backup is safer than undoing success.
      }
    }
    return this.finalDir;
  }

  private failureDir(): string {
    return join(this.outputRoot, ".failed", this.caseId, this.runId);
  }

  block(error: unknown): string {
    this.writeJson("failure.json", asAppError(error).toJSON());
    const target = this.failureDir();
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(this.temporaryDir, target);
    this.closed = true;
    return target;
  }

  fail(error: unknown): string {
    rmSync(this.temporaryDir, { recursive: true, force: true });
    mkdirSync(this.temporaryDir, { recursive: true });
    this.writeJson("failure.json", asAppError(error).toJSON());
    const target = this.failureDir();
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(this.temporaryDir, target);
    this.closed = true;
    return target;
  }
}

export interface RunArtifacts {
  mode: ReportMode;
  files: string[];
}

export interface WriteAnalysisArtifactsInput {
  loaded: LoadedCase;
  split: SplitMembership;
  evidence: CandidateEvidence[];
  manifest: PolicyManifest;
  evaluation: HoldoutEvaluation;
  prospectPreview: ScoredRecord[];
  mode: "analysis_only" | "complete";
  deploymentPreview?: unknown;
}

function normalizedDealRow(deal: NormalizedDeal): Record<string, unknown> {
  return {
    source_record_id: deal.sourceRecordId,
    source_rows: deal.sourceRowNumbers.join(";"),
    company_name: deal.originalCompanyName,
    company_identity_group_id: deal.companyIdentityGroupId,
    canonical_domain: deal.canonicalDomain ?? "",
    domain_source: deal.domainSource,
    location: deal.normalizedLocation ?? "",
    close_date: deal.closeDate,
    outcome: deal.outcome ?? "",
    fields: deal.fields,
    warnings: deal.warnings.join("; "),
  };
}

export function writeAnalysisArtifacts(
  writer: ArtifactWriter,
  input: WriteAnalysisArtifactsInput,
): RunArtifacts {
  writer.writeJson("run-metadata.json", {
    schema_version: "1.0",
    case_id: input.loaded.brief.case_id,
    scenario: "synthetic",
    mode: input.mode,
    status: input.mode === "analysis_only" ? "analysis_only" : "complete",
  });
  writer.writeJson("source-fingerprint.json", {
    schema_version: "1.0",
    source_fingerprint: input.manifest.source_fingerprint,
  });
  writer.writeJson("data-quality.json", {
    schema_version: "1.0",
    ...input.loaded.ingestion.diagnostics,
    prohibited_columns: input.loaded.brief.prohibited_columns,
    warnings: [
      ...input.loaded.ingestion.deals.flatMap((deal) =>
        deal.warnings.map((warning) => ({ source_record_id: deal.sourceRecordId, warning })),
      ),
      ...input.loaded.ingestion.prospects.flatMap((prospect) =>
        prospect.warnings.map((warning) => ({
          source_record_id: prospect.sourceRecordId,
          warning,
        })),
      ),
    ],
  });
  writer.writeText(
    "data-quality.md",
    `# Data-quality findings\n\n- Historical rows: ${input.loaded.ingestion.diagnostics.historical_source_rows}\n- Normalized deals: ${input.loaded.ingestion.diagnostics.normalized_deals}\n- Duplicate exports collapsed: ${input.loaded.ingestion.diagnostics.exact_duplicate_rows_collapsed}\n- Identity groups: ${input.loaded.ingestion.diagnostics.identity_groups}\n- Warnings: ${input.loaded.ingestion.diagnostics.warning_count}\n- Prohibited leakage fields: ${input.loaded.brief.prohibited_columns.join(", ")}\n`,
  );
  writer.writeCsv(
    "normalized-deals.redacted.csv",
    input.loaded.ingestion.deals
      .slice()
      .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId))
      .map(normalizedDealRow),
    [
      "source_record_id",
      "source_rows",
      "company_name",
      "company_identity_group_id",
      "canonical_domain",
      "domain_source",
      "location",
      "close_date",
      "outcome",
      "fields",
      "warnings",
    ],
  );
  writer.writeJson("split-membership.json", {
    schema_version: "1.0",
    strategy: "grouped_temporal",
    training_rows: input.split.trainingDeals.length,
    holdout_rows: input.split.holdoutDeals.length,
    actual_holdout_fraction: input.split.actualHoldoutFraction,
    holdout_cutoff_date: input.split.holdoutCutoffDate,
    membership: input.split.membership,
  });
  writer.writeJson("signal-evidence.json", input.evidence);
  writer.writeJson("policy-manifest.json", input.manifest, PolicyManifestSchema);
  writer.writeJson("holdout-evaluation.json", input.evaluation);
  writer.writeCsv(
    "prospect-preview.csv",
    input.prospectPreview.map((row) => ({
      rank: row.rank,
      source_record_id: row.source_record_id,
      company_name: row.company_name,
      local_policy_score: row.local_policy_score,
      known_signal_count: row.known_signal_count,
      unknown_signal_count: row.unknown_signal_count,
      vetoed: row.vetoed,
      veto_matches: row.veto_matches.join(";"),
    })),
    [
      "rank",
      "source_record_id",
      "company_name",
      "local_policy_score",
      "known_signal_count",
      "unknown_signal_count",
      "vetoed",
      "veto_matches",
    ],
  );
  const report = renderDeploymentReport({
    brief: input.loaded.brief,
    state: input.loaded.state,
    diagnostics: input.loaded.ingestion.diagnostics,
    split: input.split,
    evidence: input.evidence,
    manifest: input.manifest,
    evaluation: input.evaluation,
    prospectPreview: input.prospectPreview,
    mode: input.mode,
    ...(input.deploymentPreview === undefined
      ? {}
      : { deploymentPreview: input.deploymentPreview }),
  });
  writer.writeText("deployment-report.md", report);
  writer.writeText(
    "summary.txt",
    renderSummary({
      caseId: input.loaded.brief.case_id,
      mode: input.mode,
      selectedQuestionCount: input.manifest.question_additions.length,
      antiPatternCount: input.manifest.anti_pattern_additions.length,
      policyCoverage: input.evaluation.policy_coverage,
      topBucketLiftPp: input.evaluation.top_bucket_lift_pp,
      deploymentStatus: input.deploymentPreview === undefined ? "not_run" : "projected",
    }),
  );
  return { mode: input.mode, files: [...ANALYSIS_ARTIFACTS] };
}

export function readArtifactJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
