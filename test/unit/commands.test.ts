import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAnalyze, runDemo, runPreview, runValidate } from "../../src/commands.js";
import type { LeadbayPreviewResult } from "../../src/leadbay/preview-deployment.js";
import { ArtifactWriter } from "../../src/reporting/artifacts.js";
import { AppError } from "../../src/shared/errors.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "leadbay-commands-"));
  roots.push(value);
  return value;
}

function previewResult(): LeadbayPreviewResult {
  return {
    fixtures: [
      {
        request: { method: "GET", url: "https://leadbay.invalid/1.6/users/me" },
        response: { status: 200, headers: { "content-type": "application/json" }, body: {} },
      },
    ],
    attestation: {
      mock_environment: true,
      invalid_base_url: true,
      mock_banner: true,
      fixture_backed_read: true,
      tool_contracts: true,
      no_production_hosts: true,
      attested: true,
    },
    trace: { schema_version: "1.0", items: [], stderr: "[leadbay mock] loaded 4 fixtures\n" },
    preview: {
      schema_version: "1.0",
      status: "projected",
      persisted: false,
      accepted_tool_inputs: [],
      starting_state: {
        schema_version: "1.0",
        region: "us",
        user: { id: "u", admin: true, organization: { id: 1, name: "Org" } },
        qualification_questions: [],
        ideal_buyer_profile: null,
        targeting_prompt: null,
      },
      projected_state: {
        schema_version: "1.0",
        region: "us",
        user: { id: "u", admin: true, organization: { id: 1, name: "Org" } },
        qualification_questions: [],
        ideal_buyer_profile: null,
        targeting_prompt: null,
      },
    },
  };
}

async function appError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    return error as AppError;
  }
  throw new Error("Expected AppError");
}

describe("command workflows", () => {
  it("validate reads the case without analysis, MCP, or success artifacts", async () => {
    const before = readdirSync("fixtures/building-materials-distributor").sort();
    const result = await runValidate({ caseDir: "fixtures/building-materials-distributor" });
    expect(result).toMatchObject({
      command: "validate",
      case_id: "building-materials-distributor",
      valid: true,
    });
    expect(readdirSync("fixtures/building-materials-distributor").sort()).toEqual(before);
  });

  it("analyze writes the analysis inventory and marks the report analysis_only", async () => {
    const outputRoot = root();
    const outDir = join(outputRoot, "analysis");
    const result = await runAnalyze({
      caseDir: "fixtures/building-materials-distributor",
      outDir,
      dependencies: { runId: () => "analysis-run" },
    });
    expect(result.output_dir).toBe(outDir);
    expect(readFileSync(join(outDir, "run-metadata.json"), "utf8")).toContain(
      '"mode": "analysis_only"',
    );
    expect(readFileSync(join(outDir, "deployment-report.md"), "utf8")).toContain(
      "Not run in analysis_only mode",
    );
    expect(existsSync(join(outDir, "leadbay-mcp-trace.json"))).toBe(false);
  });

  it("preview rejects source fingerprints and state counts that differ from the case", async () => {
    const outputRoot = root();
    const analysisDir = join(outputRoot, "analysis");
    await runAnalyze({
      caseDir: "fixtures/building-materials-distributor",
      outDir: analysisDir,
      dependencies: { runId: () => "analysis-run" },
    });
    const manifestPath = join(analysisDir, "policy-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.source_fingerprint = `sha256:${"f".repeat(64)}`;
    const badPath = join(outputRoot, "bad-manifest.json");
    await import("node:fs").then(({ writeFileSync }) =>
      writeFileSync(badPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    );
    const error = await appError(() =>
      runPreview({
        caseDir: "fixtures/building-materials-distributor",
        manifestPath: badPath,
        outDir: join(outputRoot, "preview"),
        dependencies: { mcpRunner: async () => previewResult(), runId: () => "preview-run" },
      }),
    );
    expect(error.code).toBe("MANIFEST_SOURCE_MISMATCH");
    expect(error.exitCode).toBe(2);
  });

  it("preview rejects a hand-edited policy even when the source fingerprint still matches", async () => {
    const outputRoot = root();
    const analysisDir = join(outputRoot, "analysis");
    await runAnalyze({
      caseDir: "fixtures/building-materials-distributor",
      outDir: analysisDir,
      dependencies: { runId: () => "analysis-run" },
    });
    const manifestPath = join(analysisDir, "policy-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.question_additions[0].text =
      "Is the company likely to have a different qualification trait?";
    const badPath = join(outputRoot, "edited-manifest.json");
    await import("node:fs").then(({ writeFileSync }) =>
      writeFileSync(badPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    );

    let mcpCalls = 0;
    const error = await appError(() =>
      runPreview({
        caseDir: "fixtures/building-materials-distributor",
        manifestPath: badPath,
        outDir: join(outputRoot, "preview"),
        dependencies: {
          mcpRunner: async () => {
            mcpCalls++;
            return previewResult();
          },
          runId: () => "preview-run",
        },
      }),
    );

    expect(error.code).toBe("MANIFEST_SOURCE_MISMATCH");
    expect(error.details).toMatchObject({ policy_content_matches: false });
    expect(mcpCalls).toBe(0);
  });

  it("demo performs analysis then preview and commits the full inventory", async () => {
    const outputRoot = root();
    const outDir = join(outputRoot, "demo");
    let mcpCalls = 0;
    const result = await runDemo({
      caseDir: "fixtures/building-materials-distributor",
      outDir,
      dependencies: {
        mcpRunner: async (input) => {
          mcpCalls++;
          const value = previewResult();
          value.preview.starting_state = input.state;
          value.preview.projected_state = input.state;
          return value;
        },
        runId: () => "demo-run",
      },
    });
    expect(mcpCalls).toBe(1);
    expect(result.output_dir).toBe(outDir);
    expect(readdirSync(outDir).sort()).toHaveLength(16);
    expect(
      JSON.parse(readFileSync(join(outDir, "leadbay-deployment-preview.json"), "utf8")),
    ).toMatchObject({
      status: "projected",
      persisted: false,
    });
    expect(readFileSync(join(outDir, "deployment-report.md"), "utf8")).toContain(
      "Mock-only projected deployment",
    );
  });

  it("runs the complete workflow without the synthetic expected-policy oracle", async () => {
    const workspace = root();
    const caseDir = join(workspace, "case");
    const outDir = join(workspace, "demo-without-oracle");
    cpSync("fixtures/building-materials-distributor", caseDir, { recursive: true });
    rmSync(join(caseDir, "expected-policy.json"));

    let mcpCalls = 0;
    const result = await runDemo({
      caseDir,
      outDir,
      dependencies: {
        mcpRunner: async (input) => {
          mcpCalls++;
          const value = previewResult();
          value.preview.starting_state = input.state;
          value.preview.projected_state = input.state;
          return value;
        },
        runId: () => "oracle-free-run",
      },
    });

    expect(mcpCalls).toBe(1);
    expect(result.output_dir).toBe(outDir);
    expect(existsSync(join(outDir, "policy-manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, "holdout-evaluation.json"))).toBe(true);
  });

  it("maps MCP, safety, and artifact failures to their stable exit codes", async () => {
    for (const exitCode of [4, 5] as const) {
      const outputRoot = root();
      const error = await appError(() =>
        runDemo({
          caseDir: "fixtures/building-materials-distributor",
          outDir: join(outputRoot, `failure-${exitCode}`),
          dependencies: {
            mcpRunner: async () => {
              throw new AppError({
                code: `TEST_${exitCode}`,
                exitCode,
                message: "failed",
                hint: "inspect",
              });
            },
            runId: () => `failure-${exitCode}`,
          },
        }),
      );
      expect(error.exitCode).toBe(exitCode);
    }
    const artifactError = await appError(() =>
      runAnalyze({
        caseDir: "fixtures/building-materials-distributor",
        outDir: join(root(), "artifact-failure"),
        dependencies: {
          writerFactory: () => {
            throw new AppError({
              code: "TEST_ARTIFACT_FAILURE",
              exitCode: 6,
              message: "failed",
              hint: "inspect",
            });
          },
        },
      }),
    );
    expect(artifactError.exitCode).toBe(6);
  });

  it("reports a failure-package write error as artifact exit code 6", async () => {
    const outputRoot = root();
    const error = await appError(() =>
      runDemo({
        caseDir: "fixtures/building-materials-distributor",
        outDir: join(outputRoot, "blocked"),
        dependencies: {
          mcpRunner: async () => {
            throw new AppError({
              code: "TEST_EVIDENCE_GATE",
              exitCode: 3,
              message: "blocked",
              hint: "review",
            });
          },
          writerFactory: (options) => {
            const writer = ArtifactWriter.begin(options);
            writer.block = () => {
              throw new AppError({
                code: "TEST_FAILURE_PACKAGE_WRITE",
                exitCode: 6,
                message: "failure package could not be written",
                hint: "inspect storage",
              });
            };
            return writer;
          },
          runId: () => "artifact-block-failure",
        },
      }),
    );
    expect(error.exitCode).toBe(6);
    expect(error.code).toBe("ARTIFACT_FAILURE_PACKAGE_FAILED");
    expect(error.details).toMatchObject({
      original_error: { code: "TEST_EVIDENCE_GATE", exit_code: 3 },
      artifact_error: { code: "TEST_FAILURE_PACKAGE_WRITE", exit_code: 6 },
    });
  });
});
