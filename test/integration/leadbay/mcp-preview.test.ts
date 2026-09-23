import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCase } from "../../../src/case/load-case.js";
import type { PolicyManifest } from "../../../src/case/schema.js";
import { runLeadbayPreview } from "../../../src/leadbay/preview-deployment.js";
import { FakeMcpSession } from "../../helpers/fake-mcp-session.js";

function manifest(): PolicyManifest {
  const loaded = loadCase("fixtures/building-materials-distributor");
  return {
    schema_version: "1.0",
    case_id: loaded.brief.case_id,
    scenario: "synthetic",
    source_fingerprint: `sha256:${"1".repeat(64)}`,
    split: {
      strategy: "grouped_temporal",
      bootstrap_seed: 1,
      training_rows: 60,
      holdout_rows: 20,
      holdout_cutoff_date: "2026-01-01",
    },
    leadbay_state: { existing_question_count: 2, free_question_slots: 3 },
    question_additions: loaded.brief.candidate_signals.slice(0, 3).map((candidate) => ({
      candidate_id: candidate.id,
      text: candidate.question,
      source: "historical_evidence" as const,
      effect_pp: 20,
      direction_stability: 0.9,
      training_support: 20,
    })),
    reserve_signals: [],
    anti_pattern_additions: loaded.brief.explicit_vetoes.map((veto) => ({
      veto_id: veto.id,
      text: veto.anti_pattern,
      source: "customer_brief" as const,
    })),
    required_human_approvals: [
      "qualification_question_additions",
      "ideal_buyer_profile_anti_pattern_additions",
    ],
  };
}

function readResult() {
  const state = loadCase("fixtures/building-materials-distributor").state;
  return {
    qualification_questions: state.qualification_questions,
    count: state.qualification_questions.length,
    ideal_buyer_profile: state.ideal_buyer_profile,
    targeting_prompt: state.targeting_prompt,
    is_admin: true,
    region: state.region,
  };
}

describe("Leadbay mock deployment preview", () => {
  it("uses two separated writes, runs questions last, and labels state projected", async () => {
    const loaded = loadCase("fixtures/building-materials-distributor");
    const fixtureDir = mkdtempSync(join(tmpdir(), "leadbay-preview-fixtures-"));
    const fake = new FakeMcpSession({ readResult: readResult() });
    try {
      const result = await runLeadbayPreview({
        state: loaded.state,
        manifest: manifest(),
        fixtureDir,
        triggeredBy: "leadbay-deploy preview",
        sessionFactory: async () => fake,
        bannerTimeoutMs: 25,
      });
      const triggeredBy = "leadbay-deploy preview";
      const writes = fake.calls.filter(
        (item) => item.name === "leadbay_set_qualification_questions",
      );
      expect(writes).toEqual([
        {
          name: "leadbay_set_qualification_questions",
          input: {
            _triggered_by: triggeredBy,
            add_anti_patterns: ["Inactive, dissolved, or liquidated companies"],
          },
        },
        {
          name: "leadbay_set_qualification_questions",
          input: {
            _triggered_by: triggeredBy,
            add: manifest().question_additions.map((item) => item.text),
          },
        },
      ]);
      expect(
        fake.calls.find((item) => item.name === "leadbay_get_qualification_questions"),
      ).toEqual({
        name: "leadbay_get_qualification_questions",
        input: { _triggered_by: triggeredBy },
      });
      expect(result.preview.accepted_tool_inputs).toEqual([
        {
          name: "leadbay_set_qualification_questions",
          input: { add_anti_patterns: ["Inactive, dissolved, or liquidated companies"] },
        },
        {
          name: "leadbay_set_qualification_questions",
          input: { add: manifest().question_additions.map((item) => item.text) },
        },
      ]);
      expect(fake.calls.map((item) => item.name)).toEqual([
        "tools/list",
        "leadbay_get_qualification_questions",
        "leadbay_set_qualification_questions",
        "leadbay_set_qualification_questions",
      ]);
      expect(result.preview.status).toBe("projected");
      expect(result.preview.persisted).toBe(false);
      expect(result.preview.projected_state.qualification_questions).toHaveLength(5);
      expect(result.preview.projected_state.ideal_buyer_profile?.anti_patterns).toContain(
        "Inactive, dissolved, or liquidated companies",
      );
      expect(result.trace.items.at(-1)).toMatchObject({
        tool_name: "leadbay_set_qualification_questions",
        session_attested: true,
      });
      expect(fake.closed).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
