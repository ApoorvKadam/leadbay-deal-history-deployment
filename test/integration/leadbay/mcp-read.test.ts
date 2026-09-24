import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCase } from "../../../src/case/load-case.js";
import { buildMockEnvironment } from "../../../src/leadbay/mcp-client.js";
import { runLeadbayPreview } from "../../../src/leadbay/preview-deployment.js";
import { FakeMcpSession } from "../../helpers/fake-mcp-session.js";

function readResult() {
  const state = loadCase("fixtures/building-materials-distributor").state;
  return {
    qualification_questions: state.qualification_questions.map((item) => ({
      ...item,
      created_at: "2026-01-01T00:00:00Z",
    })),
    count: state.qualification_questions.length,
    ideal_buyer_profile: state.ideal_buyer_profile,
    targeting_prompt: state.targeting_prompt,
    is_admin: state.user.admin,
    region: state.region,
  };
}

describe("Leadbay MCP read contract", () => {
  it("locks the mock environment and verifies the expected tool/read contract", async () => {
    const loaded = loadCase("fixtures/building-materials-distributor");
    const fixtureDir = mkdtempSync(join(tmpdir(), "leadbay-read-fixtures-"));
    const fake = new FakeMcpSession({ readResult: readResult() });
    try {
      const environment = buildMockEnvironment(fixtureDir, {
        LEADBAY_TOKEN: "real-token-must-not-survive",
        LEADBAY_PASSWORD: "real-password-must-not-survive",
        LEADBAY_BASE_URL: "https://api-us.leadbay.app",
        AWS_ACCESS_KEY_ID: "aws-access-must-not-survive",
        AWS_SECRET_ACCESS_KEY: "aws-secret-must-not-survive",
        GITHUB_TOKEN: "github-token-must-not-survive",
        NPM_TOKEN: "npm-token-must-not-survive",
        HTTP_PROXY: "http://proxy.example",
        HTTPS_PROXY: "http://proxy.example",
        NODE_OPTIONS: "--require /tmp/untrusted-preload.cjs",
        HOME: "/real/home",
        LOGNAME: "real-user",
        USER: "real-user",
        USERPROFILE: "C:\\Users\\real-user",
        APPDATA: "C:\\Users\\real-user\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\real-user\\AppData\\Local",
        HOMEDRIVE: "C:",
        HOMEPATH: "\\Users\\real-user",
        USERNAME: "real-user",
        PATH: process.env.PATH ?? "",
      });
      expect(environment).toMatchObject({
        LEADBAY_MOCK: "1",
        LEADBAY_MOCK_DIR: fixtureDir,
        LEADBAY_MCP_WRITE: "1",
        LEADBAY_TELEMETRY_ENABLED: "false",
        LEADBAY_TOKEN: "synthetic-demo-token",
        LEADBAY_REGION: "us",
        LEADBAY_BASE_URL: "https://leadbay.invalid",
      });
      expect(JSON.stringify(environment)).not.toContain("real-token-must-not-survive");
      expect(JSON.stringify(environment)).not.toContain("real-password-must-not-survive");
      expect(environment.HOME).toBe(join(fixtureDir, ".home"));
      expect(environment.USERPROFILE).toBe(join(fixtureDir, ".home"));
      expect(environment.APPDATA).toBe(join(fixtureDir, ".home", "appdata", "roaming"));
      expect(environment.LOCALAPPDATA).toBe(join(fixtureDir, ".home", "appdata", "local"));
      expect(Object.values(environment).join("\n")).not.toContain("real-user");
      for (const forbidden of [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "GITHUB_TOKEN",
        "NPM_TOKEN",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NODE_OPTIONS",
      ]) {
        expect(environment).not.toHaveProperty(forbidden);
      }
      const result = await runLeadbayPreview({
        state: loaded.state,
        manifest: {
          schema_version: "1.0",
          case_id: loaded.brief.case_id,
          scenario: "synthetic",
          source_fingerprint: `sha256:${"0".repeat(64)}`,
          split: {
            strategy: "grouped_temporal",
            bootstrap_seed: 1,
            training_rows: 1,
            holdout_rows: 1,
            holdout_cutoff_date: "2026-01-01",
          },
          leadbay_state: { existing_question_count: 2, free_question_slots: 3 },
          question_additions: [],
          reserve_signals: [],
          anti_pattern_additions: [],
          required_human_approvals: [],
        },
        fixtureDir,
        triggeredBy: "leadbay-deploy preview",
        sessionFactory: async () => fake,
        bannerTimeoutMs: 25,
      });
      expect(result.attestation.attested).toBe(true);
      expect(result.attestation.mock_banner).toBe(true);
      expect(result.attestation.fixture_backed_read).toBe(true);
      expect(result.attestation.tool_contracts).toBe(true);
      expect(fake.calls.map((item) => item.name)).toEqual([
        "tools/list",
        "leadbay_get_qualification_questions",
      ]);
      expect(fake.closed).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
