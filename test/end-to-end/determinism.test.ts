import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAnalyze } from "../../src/commands.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "leadbay-determinism-"));
  roots.push(value);
  return value;
}

const stableFiles = [
  "normalized-deals.redacted.csv",
  "split-membership.json",
  "signal-evidence.json",
  "policy-manifest.json",
  "holdout-evaluation.json",
  "prospect-preview.csv",
  "deployment-report.md",
];

describe("deterministic analytical artifacts", () => {
  it("writes byte-identical analytical outputs for the same case and seed", async () => {
    const outputRoot = root();
    const first = join(outputRoot, "first");
    const second = join(outputRoot, "second");
    await runAnalyze({
      caseDir: "fixtures/building-materials-distributor",
      outDir: first,
      dependencies: { runId: () => "first" },
    });
    await runAnalyze({
      caseDir: "fixtures/building-materials-distributor",
      outDir: second,
      dependencies: { runId: () => "second" },
    });
    for (const file of stableFiles) {
      expect(readFileSync(join(first, file))).toEqual(readFileSync(join(second, file)));
    }
  });
});
