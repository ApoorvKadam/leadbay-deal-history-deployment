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
  it("documents the customer problem, safety contract, operation, and verified repository state", () => {
    const readme = text("README.md");
    expect(readme).toMatch(/historical won\/lost deals/i);
    expect(readme).toMatch(/synthetic/i);
    expect(readme).toMatch(/synthetic lift.*recovery check/i);
    expect(readme).toMatch(/CRM or enrichment fields/i);
    expect(readme).toMatch(/test oracle only/i);
    expect(readme).toMatch(/CLI does not load it/i);
    expect(readme).toMatch(/no live-apply path/i);
    expect(readme).toContain("Node.js 22");
    expect(readme).toContain("pnpm 9.15.4");
    expect(readme).toContain("`leadbay-deploy`");
    for (const command of ["validate", "analyze", "preview", "demo"]) {
      expect(readme).toMatch(new RegExp(`node dist/cli\\.js ${command}\\b`));
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
    expect(readme).toContain("@leadbay/mcp@0.40.0");
    expect(readme).toContain("@modelcontextprotocol/sdk@1.29.0");
    expect(readme).toMatch(/verified against the real Leadbay package/i);
    expect(readme).toMatch(/audit of production dependencies/i);
    expect(readme).toMatch(/compiled CLI contract/i);
    expect(readme).toMatch(/not an official Leadbay product/i);
    expect(readme).toMatch(/5-deal top bucket/i);
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
      "multi_site_operations",
      "enterprise_scale",
      "recent_funding",
      "warehouse_density",
      "inactive_company",
    ]) {
      expect(deploymentCase).toContain(id);
    }
    expect(deploymentCase).toMatch(/not causal evidence/i);
    expect(deploymentCase).toMatch(/does not predict real customer revenue/i);
    expect(deploymentCase).toMatch(/status at close/i);
  });

  it("publishes inspectable real-MCP evidence from CI", () => {
    const workflow = text(".github/workflows/ci.yml");
    expect(workflow).toMatch(/actions\/upload-artifact@[0-9a-f]{40}/);
    expect(workflow).toContain("artifacts/building-materials-distributor/");
    expect(workflow).toContain("retention-days: 90");
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
    expect(demo).toMatch(/approval/i);
    expect(demo).toContain("30-day monitoring plan");
    expect(demo).toMatch(/not live Leadbay validation/i);
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
    expect(notice).toContain("@leadbay/mcp@0.40.0");
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

  it("keeps the curated package aligned with the current synthetic policy", () => {
    const expected = json("fixtures/building-materials-distributor/expected-policy.json") as {
      selected_candidate_ids: string[];
      exact_questions: Record<string, string>;
    };
    const manifest = json(join(exampleRoot, "policy-manifest.json")) as {
      question_additions: Array<{ candidate_id: string; text: string }>;
    };
    const selected = manifest.question_additions.map((item) => item.candidate_id).sort();
    expect(selected).toEqual([...expected.selected_candidate_ids].sort());
    for (const item of manifest.question_additions) {
      expect(item.text).toBe(expected.exact_questions[item.candidate_id]);
    }

    const report = text(join(exampleRoot, "deployment-report.md"));
    expect(report).toContain("multi_site_operations");
    expect(report).not.toContain("crm_exportability");

    const preview = DeploymentPreviewSchema.parse(
      json(join(exampleRoot, "leadbay-deployment-preview.json")),
    );
    const questionWrite = preview.accepted_tool_inputs.find((item) =>
      Array.isArray(item.input.add),
    );
    expect(questionWrite?.input.add).toEqual(manifest.question_additions.map((item) => item.text));
  });
});
