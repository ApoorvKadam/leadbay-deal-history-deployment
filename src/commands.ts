import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { type CandidateEvidence, deriveSignalEvidence } from "./analysis/evidence.js";
import { type SplitMembership, groupedTemporalSplit } from "./analysis/split.js";
import { type LoadedCase, loadCase } from "./case/load-case.js";
import { type PolicyManifest, PolicyManifestSchema } from "./case/schema.js";
import { type HoldoutEvaluation, calculateHoldoutMetrics } from "./evaluation/metrics.js";
import { type ScoredRecord, scorePolicy } from "./evaluation/score-policy.js";
import {
  type LeadbayPreviewResult,
  type RunLeadbayPreviewInput,
  runLeadbayPreview,
} from "./leadbay/preview-deployment.js";
import { buildPolicyManifest } from "./policy/manifest.js";
import { type PolicySelection, selectPolicy } from "./policy/select-policy.js";
import {
  ANALYSIS_ARTIFACTS,
  ArtifactWriter,
  type ArtifactWriterOptions,
  DEMO_ARTIFACTS,
  writeAnalysisArtifacts,
} from "./reporting/artifacts.js";
import { renderDeploymentReport, renderSummary } from "./reporting/markdown-report.js";
import { AppError, asAppError } from "./shared/errors.js";
import { stableStringify } from "./shared/stable-json.js";

export const PREVIEW_ARTIFACTS = [
  "run-metadata.json",
  "leadbay-mcp-trace.json",
  "mock-session-attestation.json",
  "leadbay-deployment-preview.json",
  "generated-mock-fixtures",
  "deployment-report.md",
  "summary.txt",
] as const;

export interface AnalysisBundle {
  loaded: LoadedCase;
  split: SplitMembership;
  evidence: CandidateEvidence[];
  selection: PolicySelection;
  manifest: PolicyManifest;
  evaluation: HoldoutEvaluation;
  prospectPreview: ScoredRecord[];
}

export interface CommandDependencies {
  mcpRunner: (input: RunLeadbayPreviewInput) => Promise<LeadbayPreviewResult>;
  writerFactory: (options: ArtifactWriterOptions) => ArtifactWriter;
  runId: (command: "analyze" | "preview" | "demo") => string;
}

const DEFAULT_DEPENDENCIES: CommandDependencies = {
  mcpRunner: runLeadbayPreview,
  writerFactory: ArtifactWriter.begin,
  runId: (command) => `${command}-${Date.now()}-${randomUUID().slice(0, 8)}`,
};

function dependencies(overrides?: Partial<CommandDependencies>): CommandDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

export function analyzeLoadedCase(loaded: LoadedCase): AnalysisBundle {
  const split = groupedTemporalSplit(loaded.ingestion.deals, {
    holdoutFraction: loaded.brief.analysis.holdout_fraction,
    minimumTrainingClassCount: loaded.brief.analysis.minimum_class_count,
    minimumHoldoutClassCount: loaded.brief.analysis.minimum_holdout_class_count,
  });
  const evidence = deriveSignalEvidence(split.trainingDeals, loaded.brief.candidate_signals, {
    bootstrapSeed: loaded.brief.analysis.bootstrap_seed,
    bootstrapSamples: loaded.brief.analysis.bootstrap_samples,
    minimumLabeledDeals: loaded.brief.analysis.minimum_labeled_deals,
    minimumClassCount: loaded.brief.analysis.minimum_class_count,
    prohibitedColumns: loaded.brief.prohibited_columns,
  });
  const selection = selectPolicy({
    brief: loaded.brief,
    state: loaded.state,
    evidence,
    deals: loaded.ingestion.deals,
  });
  const manifest = buildPolicyManifest({
    brief: loaded.brief,
    state: loaded.state,
    deals: loaded.ingestion.deals,
    prospects: loaded.ingestion.prospects,
    split,
    evidence,
    selection,
  });
  const evaluation = calculateHoldoutMetrics(
    scorePolicy(split.holdoutDeals, loaded.brief, manifest),
    loaded.brief,
  );
  const prospectPreview = scorePolicy(loaded.ingestion.prospects, loaded.brief, manifest);
  return { loaded, split, evidence, selection, manifest, evaluation, prospectPreview };
}

function assertSafeOutputArgument(outDir: string): void {
  const segments = outDir.replace(/\\/g, "/").split("/");
  if (outDir.includes("\0") || segments.includes("..")) {
    throw new AppError({
      code: "OUTPUT_ARGUMENT_UNSAFE",
      exitCode: 2,
      message: `Output path contains unsafe traversal: ${outDir}.`,
      hint: "Choose an output directory without parent traversal segments.",
      details: { out: outDir },
    });
  }
}

function writerOptions(outDir: string, caseId: string, runId: string): ArtifactWriterOptions {
  assertSafeOutputArgument(outDir);
  const finalDir = resolve(outDir);
  return { outputRoot: dirname(finalDir), finalDir, caseId, runId };
}

function evidenceGate(bundle: AnalysisBundle): void {
  if (bundle.selection.deploymentBlocked) {
    throw new AppError({
      code: "VETO_TRADEOFF_UNACKNOWLEDGED",
      exitCode: 3,
      message:
        "An explicit veto matches at least one historical win without an acknowledged tradeoff.",
      hint: "Review the named wins and verify the veto matched their status at close, not only the export-time CRM state, before any Leadbay preview.",
      details: { historical_win_ids: bundle.selection.vetoedHistoricalWinIds },
    });
  }
}

function fixtureName(index: number): string {
  return `${String(index + 1).padStart(2, "0")}-fixture.json`;
}

function writePreviewArtifacts(
  writer: ArtifactWriter,
  bundle: AnalysisBundle,
  manifest: PolicyManifest,
  evaluation: HoldoutEvaluation,
  prospectPreview: ScoredRecord[],
  previewResult: LeadbayPreviewResult,
  mode: "preview_only" | "complete",
): void {
  writer.writeJson("run-metadata.json", {
    schema_version: "1.0",
    case_id: bundle.loaded.brief.case_id,
    scenario: "synthetic",
    mode,
    status: mode,
  });
  writer.writeJson("leadbay-mcp-trace.json", previewResult.trace);
  writer.writeJson("mock-session-attestation.json", previewResult.attestation);
  writer.writeJson("leadbay-deployment-preview.json", previewResult.preview);
  previewResult.fixtures.forEach((fixture, index) => {
    writer.writeJson(join("generated-mock-fixtures", fixtureName(index)), fixture);
  });
  writer.writeText(
    "deployment-report.md",
    renderDeploymentReport({
      brief: bundle.loaded.brief,
      state: bundle.loaded.state,
      diagnostics: bundle.loaded.ingestion.diagnostics,
      split: bundle.split,
      evidence: bundle.evidence,
      manifest,
      evaluation,
      prospectPreview,
      mode,
      deploymentPreview: previewResult.preview,
    }),
  );
  writer.writeText(
    "summary.txt",
    renderSummary({
      caseId: bundle.loaded.brief.case_id,
      mode,
      selectedQuestionCount: manifest.question_additions.length,
      antiPatternCount: manifest.anti_pattern_additions.length,
      policyCoverage: evaluation.policy_coverage,
      topBucketLiftPp: evaluation.top_bucket_lift_pp,
      deploymentStatus: "projected",
    }),
  );
}

function handleWriterFailure(
  writer: ArtifactWriter | undefined,
  error: unknown,
  diagnosticsWritten: boolean,
): never {
  const app = asAppError(error);
  if (writer) {
    try {
      if (diagnosticsWritten && app.exitCode === 3) writer.block(app);
      else writer.fail(app);
    } catch (artifactError) {
      const artifact = asAppError(artifactError);
      throw new AppError({
        code: "ARTIFACT_FAILURE_PACKAGE_FAILED",
        exitCode: 6,
        message: "The command failed and its failure package could not be written.",
        hint: "Inspect filesystem permissions and storage, then rerun the command.",
        details: { original_error: app.toJSON(), artifact_error: artifact.toJSON() },
        cause: artifactError,
      });
    }
  }
  throw app;
}

export interface ValidateCommandInput {
  caseDir: string;
}

export interface ValidateCommandResult {
  command: "validate";
  case_id: string;
  valid: true;
  historical_rows: number;
  prospects: number;
}

export async function runValidate(input: ValidateCommandInput): Promise<ValidateCommandResult> {
  const loaded = loadCase(input.caseDir);
  return {
    command: "validate",
    case_id: loaded.brief.case_id,
    valid: true,
    historical_rows: loaded.ingestion.deals.length,
    prospects: loaded.ingestion.prospects.length,
  };
}

export interface AnalyzeCommandInput {
  caseDir: string;
  outDir: string;
  dependencies?: Partial<CommandDependencies>;
}

export interface ArtifactCommandResult {
  command: "analyze" | "preview" | "demo";
  case_id: string;
  output_dir: string;
}

export async function runAnalyze(input: AnalyzeCommandInput): Promise<ArtifactCommandResult> {
  const deps = dependencies(input.dependencies);
  const bundle = analyzeLoadedCase(loadCase(input.caseDir));
  let writer: ArtifactWriter | undefined;
  let diagnosticsWritten = false;
  try {
    writer = deps.writerFactory(
      writerOptions(input.outDir, bundle.loaded.brief.case_id, deps.runId("analyze")),
    );
    writeAnalysisArtifacts(writer, { ...bundle, mode: "analysis_only" });
    diagnosticsWritten = true;
    evidenceGate(bundle);
    const outputDir = writer.commit(ANALYSIS_ARTIFACTS);
    return { command: "analyze", case_id: bundle.loaded.brief.case_id, output_dir: outputDir };
  } catch (error) {
    return handleWriterFailure(writer, error, diagnosticsWritten);
  }
}

function readManifest(path: string): PolicyManifest {
  try {
    return PolicyManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "MANIFEST_INVALID",
      exitCode: 2,
      message: `Policy manifest is invalid: ${path}.`,
      hint: "Use policy-manifest.json generated by this case and version.",
      details: { manifest: path },
      cause: error,
    });
  }
}

function verifyManifestSource(manifest: PolicyManifest, bundle: AnalysisBundle): void {
  const expected = bundle.manifest;
  const sourceMatches =
    manifest.case_id === bundle.loaded.brief.case_id &&
    manifest.source_fingerprint === expected.source_fingerprint &&
    manifest.leadbay_state.existing_question_count ===
      expected.leadbay_state.existing_question_count &&
    manifest.leadbay_state.free_question_slots === expected.leadbay_state.free_question_slots;
  const policyMatches = stableStringify(manifest) === stableStringify(expected);

  if (!sourceMatches || !policyMatches) {
    throw new AppError({
      code: "MANIFEST_SOURCE_MISMATCH",
      exitCode: 2,
      message:
        "The supplied manifest does not match the policy regenerated from the current case and Leadbay state.",
      hint: "Regenerate the manifest from the unchanged case before previewing.",
      details: {
        expected_fingerprint: expected.source_fingerprint,
        actual_fingerprint: manifest.source_fingerprint,
        policy_content_matches: policyMatches,
      },
    });
  }
}

async function runMcpForBundle(
  deps: CommandDependencies,
  bundle: AnalysisBundle,
  manifest: PolicyManifest,
  fixtureDir: string,
  triggeredBy: string,
): Promise<LeadbayPreviewResult> {
  return deps.mcpRunner({
    state: bundle.loaded.state,
    manifest,
    fixtureDir,
    triggeredBy,
    unacknowledgedVetoedWinIds: bundle.selection.deploymentBlocked
      ? bundle.selection.vetoedHistoricalWinIds
      : [],
  });
}

export interface PreviewCommandInput {
  caseDir: string;
  manifestPath: string;
  outDir: string;
  dependencies?: Partial<CommandDependencies>;
}

export async function runPreview(input: PreviewCommandInput): Promise<ArtifactCommandResult> {
  const deps = dependencies(input.dependencies);
  const bundle = analyzeLoadedCase(loadCase(input.caseDir));
  const manifest = readManifest(input.manifestPath);
  verifyManifestSource(manifest, bundle);
  const evaluation = calculateHoldoutMetrics(
    scorePolicy(bundle.split.holdoutDeals, bundle.loaded.brief, manifest),
    bundle.loaded.brief,
  );
  const prospectPreview = scorePolicy(
    bundle.loaded.ingestion.prospects,
    bundle.loaded.brief,
    manifest,
  );
  if (bundle.selection.deploymentBlocked) evidenceGate(bundle);
  let writer: ArtifactWriter | undefined;
  const fixtureDir = mkdtempSync(join(tmpdir(), "leadbay-deploy-preview-"));
  try {
    writer = deps.writerFactory(
      writerOptions(input.outDir, bundle.loaded.brief.case_id, deps.runId("preview")),
    );
    const preview = await runMcpForBundle(
      deps,
      bundle,
      manifest,
      fixtureDir,
      "leadbay-deploy preview",
    );
    writePreviewArtifacts(
      writer,
      bundle,
      manifest,
      evaluation,
      prospectPreview,
      preview,
      "preview_only",
    );
    const outputDir = writer.commit(PREVIEW_ARTIFACTS);
    return { command: "preview", case_id: bundle.loaded.brief.case_id, output_dir: outputDir };
  } catch (error) {
    return handleWriterFailure(writer, error, false);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

export interface DemoCommandInput {
  caseDir: string;
  outDir: string;
  dependencies?: Partial<CommandDependencies>;
}

export async function runDemo(input: DemoCommandInput): Promise<ArtifactCommandResult> {
  const deps = dependencies(input.dependencies);
  const bundle = analyzeLoadedCase(loadCase(input.caseDir));
  let writer: ArtifactWriter | undefined;
  let diagnosticsWritten = false;
  const fixtureDir = mkdtempSync(join(tmpdir(), "leadbay-deploy-demo-"));
  try {
    writer = deps.writerFactory(
      writerOptions(input.outDir, bundle.loaded.brief.case_id, deps.runId("demo")),
    );
    writeAnalysisArtifacts(writer, { ...bundle, mode: "complete" });
    diagnosticsWritten = true;
    evidenceGate(bundle);
    const preview = await runMcpForBundle(
      deps,
      bundle,
      bundle.manifest,
      fixtureDir,
      "leadbay-deploy demo",
    );
    writePreviewArtifacts(
      writer,
      bundle,
      bundle.manifest,
      bundle.evaluation,
      bundle.prospectPreview,
      preview,
      "complete",
    );
    const outputDir = writer.commit(DEMO_ARTIFACTS);
    return { command: "demo", case_id: bundle.loaded.brief.case_id, output_dir: outputDir };
  } catch (error) {
    return handleWriterFailure(writer, error, diagnosticsWritten);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

export function defaultOutputForCase(caseDir: string): string {
  return join("artifacts", basename(resolve(caseDir)));
}

export function outputIsAbsolute(path: string): boolean {
  return isAbsolute(path) || path.split(sep).length > 1;
}
