import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDemo } from "../../src/commands.js";
import type { AppError } from "../../src/shared/errors.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "leadbay-evidence-gate-"));
  roots.push(value);
  return value;
}

describe("veto evidence gate", () => {
  it("preserves diagnostics and never starts MCP when an unacknowledged veto excludes a win", async () => {
    const workspace = root();
    const caseDir = join(workspace, "case");
    cpSync("fixtures/building-materials-distributor", caseDir, { recursive: true });
    const historyPath = join(caseDir, "historical-deals.csv");
    const lines = readFileSync(historyPath, "utf8").split("\n");
    const index = lines.findIndex((line) => line.startsWith("D-062,"));
    expect(index).toBeGreaterThan(0);
    lines[index] = lines[index]!.replace(",Active,Closed Won,", ",Inactive,Closed Won,");
    writeFileSync(historyPath, lines.join("\n"), "utf8");

    const outDir = join(workspace, "blocked");
    let mcpStarts = 0;
    let error: AppError | undefined;
    try {
      await runDemo({
        caseDir,
        outDir,
        dependencies: {
          mcpRunner: async () => {
            mcpStarts++;
            throw new Error("must not start");
          },
          runId: () => "veto-run",
        },
      });
    } catch (caught) {
      error = caught as AppError;
    }
    expect(error?.exitCode).toBe(3);
    expect(error?.hint).toMatch(/status at close|close date/i);
    expect(mcpStarts).toBe(0);
    const failureDir = join(
      dirname(outDir),
      ".failed",
      "building-materials-distributor",
      "veto-run",
    );
    for (const file of [
      "data-quality.json",
      "signal-evidence.json",
      "policy-manifest.json",
      "holdout-evaluation.json",
      "deployment-report.md",
      "failure.json",
    ]) {
      expect(existsSync(join(failureDir, file))).toBe(true);
    }
    expect(existsSync(join(failureDir, "leadbay-mcp-trace.json"))).toBe(false);
    expect(readFileSync(join(failureDir, "failure.json"), "utf8")).toContain("D-062");
    const report = readFileSync(join(failureDir, "deployment-report.md"), "utf8");
    expect(report).toContain("D-062");
    expect(report).toMatch(/export-time.*status at close|status at close.*export-time/i);
  });
});
