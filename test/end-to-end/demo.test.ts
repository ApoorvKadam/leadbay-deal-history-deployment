import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCase } from "../../src/case/load-case.js";
import { PolicyManifestSchema } from "../../src/case/schema.js";
import { parseCsvFile } from "../../src/ingestion/parse-csv.js";
import {
  DeploymentPreviewSchema,
  MockSessionAttestationSchema,
} from "../../src/leadbay/preview-deployment.js";
import { LeadbayTraceSchema } from "../../src/leadbay/trace.js";
import { DEMO_ARTIFACTS } from "../../src/reporting/artifacts.js";
import { runSyntheticDemo } from "../helpers/run-synthetic-demo.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "leadbay-e2e-"));
  roots.push(value);
  return value;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("complete synthetic deployment journey", () => {
  it("produces the exact reviewed package and semantic outcomes", async () => {
    const outDir = join(root(), "demo");
    const { fake } = await runSyntheticDemo(outDir);
    expect(readdirSync(outDir).sort()).toEqual([...DEMO_ARTIFACTS].sort());

    const loaded = loadCase("fixtures/building-materials-distributor");
    const manifest = PolicyManifestSchema.parse(json(join(outDir, "policy-manifest.json")));
    const evidence = json(join(outDir, "signal-evidence.json")) as Array<{
      candidateId: string;
      classification: string;
      priority: number;
    }>;
    const evaluation = json(join(outDir, "holdout-evaluation.json")) as {
      policy_coverage: number;
      top_bucket_lift_pp: number;
      unacknowledged_vetoed_win_ids: string[];
    };
    const trace = LeadbayTraceSchema.parse(json(join(outDir, "leadbay-mcp-trace.json")));
    const attestation = MockSessionAttestationSchema.parse(
      json(join(outDir, "mock-session-attestation.json")),
    );
    const preview = DeploymentPreviewSchema.parse(
      json(join(outDir, "leadbay-deployment-preview.json")),
    );

    const selectedIds = manifest.question_additions.map((item) => item.candidate_id);
    expect([...selectedIds].sort()).toEqual(
      [...loaded.expectedPolicy.selected_candidate_ids].sort(),
    );
    expect(selectedIds).toEqual(
      evidence
        .filter((item) => item.classification === "eligible")
        .sort(
          (left, right) =>
            right.priority - left.priority || left.candidateId.localeCompare(right.candidateId),
        )
        .slice(0, selectedIds.length)
        .map((item) => item.candidateId),
    );
    for (const [id, classification] of Object.entries(loaded.expectedPolicy.rejected_candidates)) {
      expect(evidence.find((item) => item.candidateId === id)?.classification).toBe(classification);
    }
    expect(evaluation.policy_coverage).toBeGreaterThanOrEqual(
      loaded.expectedPolicy.minimum_policy_coverage,
    );
    expect(evaluation.top_bucket_lift_pp).toBeGreaterThanOrEqual(
      loaded.expectedPolicy.minimum_top_bucket_lift_pp,
    );
    expect(evaluation.unacknowledged_vetoed_win_ids).toEqual([]);

    const prospects = parseCsvFile(join(outDir, "prospect-preview.csv"));
    const byId = new Map(prospects.rows.map((row) => [row.values.source_record_id, row.values]));
    expect(byId.get("P-STRONG")?.rank).toBe("1");
    expect(Number(byId.get("P-STRONG")?.rank)).toBeLessThan(Number(byId.get("P-WEAK")?.rank));
    expect(byId.get("P-INACTIVE")?.vetoed).toBe("true");

    const writes = trace.items.filter(
      (item) => item.tool_name === "leadbay_set_qualification_questions",
    );
    const triggeredBy = "leadbay-deploy demo";
    expect(writes).toHaveLength(2);
    expect(writes[0]?.input).toEqual({
      _triggered_by: triggeredBy,
      add_anti_patterns: ["Inactive, dissolved, or liquidated companies"],
    });
    expect(writes[1]?.input).toEqual({
      _triggered_by: triggeredBy,
      add: manifest.question_additions.map((item) => item.text),
    });
    expect(trace.items.at(-1)?.input).toEqual(writes[1]?.input);
    expect(JSON.stringify(trace)).not.toMatch(/api-(?:us|fr)\.leadbay\.app/i);
    expect(JSON.stringify(trace)).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/i);
    expect(attestation.attested).toBe(true);
    expect(preview).toMatchObject({ status: "projected", persisted: false });
    expect(fake.closed).toBe(true);
  });
});
