import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DeploymentPreviewSchema,
  MockSessionAttestationSchema,
} from "../../src/leadbay/preview-deployment.js";
import { LeadbayTraceSchema } from "../../src/leadbay/trace.js";
import { DEMO_ARTIFACTS } from "../../src/reporting/artifacts.js";

function text(path: string): string {
  return readFileSync(path, "utf8");
}

function json(path: string): unknown {
  return JSON.parse(text(path));
}

const exampleRoot = "docs/examples/building-materials-distributor";

describe("reviewer documentation", () => {
  it("keeps public Markdown free of em and en dashes", () => {
    const markdownFiles = [
      "README.md",
      ...readdirSync("docs", { recursive: true })
        .filter((path): path is string => typeof path === "string" && path.endsWith(".md"))
        .map((path) => join("docs", path)),
    ];
    for (const path of markdownFiles) {
      expect(text(path), path).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("documents the customer problem, safety contract, operation, and verified release-candidate state", () => {
    const readme = text("README.md");
    expect(readme).toMatch(/historical won\/lost deals/i);
    expect(readme).toMatch(/synthetic/i);
    expect(readme).toMatch(/no live-apply path/i);
    expect(readme).toContain("Node.js 22");
    expect(readme).toContain("pnpm 9.15.4");
    for (const command of ["validate", "analyze", "preview", "demo"]) {
      expect(readme).toMatch(new RegExp(`leadbay-deploy ${command}\\b`));
    }
    expect(readme).toContain("16 top-level entries");
    expect(readme).toContain("docs/examples/building-materials-distributor");
    for (const boundary of [
      "LEADBAY_MOCK=1",
      "https://leadbay.invalid",
      "fixture-backed",
      "mock-mode banner",
      "production hostname",
    ]) {
      expect(readme).toContain(boundary);
    }
    expect(readme).toContain("@leadbay/mcp@0.39.10");
    expect(readme).toContain("@modelcontextprotocol/sdk@1.29.0");
    expect(readme).toMatch(/verified against the real Leadbay package/i);
    expect(readme).toContain("35 test files and 131 passing tests");
    expect(readme).toMatch(/independent deployment demonstration/i);
    expect(readme).not.toMatch(/no remote is configured/i);
    expect(readme).not.toMatch(/local-only/i);
  });

  it("documents every module boundary using inputs, outputs, and dependencies", () => {
    const architecture = text("docs/architecture.md");
    for (const module of [
      "Case Loader",
      "Normalization Engine",
      "Evidence Engine",
      "Policy Builder",
      "Holdout Evaluator",
      "Artifact Writer",
      "Leadbay MCP Preview Adapter",
      "CLI Orchestrator",
    ]) {
      expect(architecture).toContain(module);
    }
    expect(architecture.match(/\*\*Inputs:\*\*/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(architecture.match(/\*\*Outputs:\*\*/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(architecture.match(/\*\*Dependencies:\*\*/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("explains the synthetic case, selected and rejected hypotheses, and non-causal status", () => {
    const deploymentCase = text("docs/deployment-case.md");
    expect(deploymentCase).toContain("seed `20260922`");
    for (const id of [
      "multi_territory_field_sales",
      "fragmented_smb_market",
      "crm_exportability",
      "enterprise_scale",
      "recent_funding",
      "warehouse_density",
      "inactive_company",
    ]) {
      expect(deploymentCase).toContain(id);
    }
    expect(deploymentCase).toMatch(/not causal evidence/i);
    expect(deploymentCase).toMatch(/does not predict real customer revenue/i);
  });

  it("contains the ten-step demo narrative without claiming live validation", () => {
    const demo = text("docs/demo-script.md");
    const markers = Array.from({ length: 10 }, (_, index) => `${index + 1}.`);
    let cursor = -1;
    for (const marker of markers) {
      const next = demo.indexOf(marker, cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(demo).toContain("messy historical CSV");
    expect(demo).toContain("pnpm demo");
    expect(demo).toContain("data-quality");
    expect(demo).toContain("three proposed questions");
    expect(demo).toContain("held-out");
    expect(demo).toContain("vetoed inactive company");
    expect(demo).toContain("MCP trace");
    expect(demo).toContain("required approvals");
    expect(demo).toContain("30-day monitoring plan");
    expect(demo).toMatch(/not live Leadbay validation/i);
    expect(demo).toMatch(/no upstream PR is open/i);
    expect(demo).not.toMatch(/\b(?:an|the) upstream PR (?:is|was) open\b/i);
  });
});

describe("curated synthetic example", () => {
  it("retains the complete stable package and explicit synthetic notice", () => {
    expect(existsSync(exampleRoot)).toBe(true);
    expect(readdirSync(exampleRoot).sort()).toEqual(
      [...DEMO_ARTIFACTS, "EXAMPLE-NOTICE.md"].sort(),
    );
    const notice = text(join(exampleRoot, "EXAMPLE-NOTICE.md"));
    expect(notice).toMatch(/synthetic/i);
    expect(notice).toContain("@leadbay/mcp@0.39.10");
    expect(notice).toMatch(/not live Leadbay validation/i);

    const attestation = MockSessionAttestationSchema.parse(
      json(join(exampleRoot, "mock-session-attestation.json")),
    );
    const preview = DeploymentPreviewSchema.parse(
      json(join(exampleRoot, "leadbay-deployment-preview.json")),
    );
    const trace = LeadbayTraceSchema.parse(json(join(exampleRoot, "leadbay-mcp-trace.json")));
    expect(attestation.attested).toBe(true);
    expect(preview).toMatchObject({ status: "projected", persisted: false });
    expect(preview.accepted_tool_inputs).toHaveLength(2);
    expect(trace.items.at(-1)?.tool_name).toBe("leadbay_set_qualification_questions");
    expect(trace.items.every((item) => item.duration_ms === 0)).toBe(true);
    expect(text(join(exampleRoot, "policy-manifest.json"))).toContain("question_additions");
    expect(text(join(exampleRoot, "holdout-evaluation.json"))).toContain("top_bucket_lift_pp");
    expect(text(join(exampleRoot, "deployment-report.md"))).toContain("Required human approvals");
  });
});
