import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runCli(args: string[]) {
  const compiled = process.env.LEADBAY_TEST_CLI_ENTRY;
  const nodeArgs = compiled ? [compiled, ...args] : ["--import", "tsx", "src/cli.ts", ...args];
  return spawnSync(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, LEADBAY_DEPLOY_DEBUG: "0" },
  });
}

describe("leadbay-deploy CLI", () => {
  it("prints usage and exits 2 when the command is missing", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("CLI_COMMAND_MISSING");
  });

  it("requires --case and rejects unknown options", () => {
    const missing = runCli(["validate"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("CLI_ARGUMENT_MISSING");
    const unknown = runCli([
      "validate",
      "--case",
      "fixtures/building-materials-distributor",
      "--wat",
    ]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("CLI_ARGUMENT_INVALID");
  });

  it("validates the committed synthetic case", () => {
    const result = runCli(["validate", "--case", "fixtures/building-materials-distributor"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"valid": true');
  });

  it("rejects an output argument containing parent traversal", () => {
    const result = runCli([
      "analyze",
      "--case",
      "fixtures/building-materials-distributor",
      "--out",
      "../escape",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("OUTPUT_ARGUMENT_UNSAFE");
  });

  it("prints stable JSON errors without stacks", () => {
    const result = runCli(["validate", "--case", "missing-case"]);
    expect(result.status).toBe(2);
    expect(() => JSON.parse(result.stderr.trim().split("\n").at(-1)!)).not.toThrow();
    const error = JSON.parse(result.stderr.trim().split("\n").at(-1)!);
    expect(error).toMatchObject({
      error: true,
      code: "CASE_ROOT_MISSING",
      exit_code: 2,
    });
    expect(result.stderr).not.toContain("at runValidate");
  });
});
