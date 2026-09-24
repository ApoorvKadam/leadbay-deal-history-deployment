import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveSignalEvidence } from "../../src/analysis/evidence.js";
import { groupedTemporalSplit } from "../../src/analysis/split.js";
import { loadCase } from "../../src/case/load-case.js";
import { PolicyManifestSchema } from "../../src/case/schema.js";
import { calculateHoldoutMetrics } from "../../src/evaluation/metrics.js";
import { scorePolicy } from "../../src/evaluation/score-policy.js";
import { LeadbayTraceSchema } from "../../src/leadbay/trace.js";
import { buildPolicyManifest } from "../../src/policy/manifest.js";
import { selectPolicy } from "../../src/policy/select-policy.js";
import {
  ANALYSIS_ARTIFACTS,
  ArtifactWriter,
  writeAnalysisArtifacts,
} from "../../src/reporting/artifacts.js";

function pipeline() {
  const loaded = loadCase("fixtures/building-materials-distributor");
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
  return { loaded, split, evidence, manifest, evaluation, prospectPreview };
}

describe("analysis artifact contracts", () => {
  it("writes the complete analysis inventory with schema-valid JSON", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "leadbay-artifact-contract-"));
    try {
      const finalDir = join(outputRoot, "building-materials-distributor");
      const writer = ArtifactWriter.begin({
        outputRoot,
        finalDir,
        caseId: "building-materials-distributor",
        runId: "analysis",
      });
      const inputs = pipeline();
      writeAnalysisArtifacts(writer, { ...inputs, mode: "analysis_only" });
      writer.commit(ANALYSIS_ARTIFACTS);
      const manifest = JSON.parse(readFileSync(join(finalDir, "policy-manifest.json"), "utf8"));
      expect(PolicyManifestSchema.parse(manifest).case_id).toBe("building-materials-distributor");
      for (const file of [
        "run-metadata.json",
        "source-fingerprint.json",
        "data-quality.json",
        "split-membership.json",
        "signal-evidence.json",
        "holdout-evaluation.json",
      ]) {
        expect(() => JSON.parse(readFileSync(join(finalDir, file), "utf8"))).not.toThrow();
      }
      expect(readFileSync(join(finalDir, "deployment-report.md"), "utf8")).toContain(
        "## 16. Limitations and non-claims",
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});

describe("committed Leadbay example provenance", () => {
  it("labels the deterministic example honestly and preserves call provenance", () => {
    const notice = readFileSync(
      "docs/examples/building-materials-distributor/EXAMPLE-NOTICE.md",
      "utf8",
    );
    expect(notice).toMatch(/deterministic test double/i);
    expect(notice).toMatch(/CI.*real.*@leadbay\/mcp@0\.40\.0/i);

    const trace = LeadbayTraceSchema.parse(
      JSON.parse(
        readFileSync("docs/examples/building-materials-distributor/leadbay-mcp-trace.json", "utf8"),
      ),
    );
    const catalog = trace.items.find((item) => item.tool_name === "tools/list")?.result;
    expect(Array.isArray(catalog)).toBe(true);
    const tools = catalog as Array<{
      name: string;
      inputSchema?: { required?: string[] };
    }>;
    for (const name of [
      "leadbay_get_qualification_questions",
      "leadbay_set_qualification_questions",
    ]) {
      const tool = tools.find((item) => item.name === name);
      expect(tool).toBeDefined();
      expect(tool?.inputSchema?.required).toContain("_triggered_by");
    }

    const writes = trace.items.filter(
      (item) => item.tool_name === "leadbay_set_qualification_questions",
    );
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.input).toMatchObject({ _triggered_by: "leadbay-deploy demo" });
    }
  });
});
