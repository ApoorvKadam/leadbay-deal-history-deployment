import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCase } from "../../../src/case/load-case.js";
import type { PolicyManifest } from "../../../src/case/schema.js";
import { runLeadbayPreview } from "../../../src/leadbay/preview-deployment.js";
import type { AppError } from "../../../src/shared/errors.js";
import { FakeMcpSession } from "../../helpers/fake-mcp-session.js";

const loaded = loadCase("fixtures/building-materials-distributor");

function manifest(): PolicyManifest {
  return {
    schema_version: "1.0",
    case_id: loaded.brief.case_id,
    scenario: "synthetic",
    source_fingerprint: `sha256:${"2".repeat(64)}`,
    split: {
      strategy: "grouped_temporal",
      bootstrap_seed: 1,
      training_rows: 60,
      holdout_rows: 20,
      holdout_cutoff_date: "2026-01-01",
    },
    leadbay_state: { existing_question_count: 2, free_question_slots: 3 },
    question_additions: [
      {
        candidate_id: loaded.brief.candidate_signals[0]!.id,
        text: loaded.brief.candidate_signals[0]!.question,
        source: "historical_evidence",
        effect_pp: 20,
        direction_stability: 0.9,
        training_support: 20,
      },
    ],
    reserve_signals: [],
    anti_pattern_additions: [
      {
        veto_id: "inactive_company",
        text: "Inactive, dissolved, or liquidated companies",
        source: "customer_brief",
      },
    ],
    required_human_approvals: [],
  };
}

function readResult() {
  return {
    qualification_questions: loaded.state.qualification_questions,
    count: 2,
    ideal_buyer_profile: loaded.state.ideal_buyer_profile,
    targeting_prompt: loaded.state.targeting_prompt,
    is_admin: true,
    region: "us",
  };
}

async function captureError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    return error as AppError;
  }
  throw new Error("Expected failure");
}

describe("Leadbay preview safety invariant", () => {
  it("makes no write when the fixture-backed read fails and still closes", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "leadbay-safety-"));
    const fake = new FakeMcpSession({ failRead: new Error("Missing mock fixture GET /questions") });
    try {
      const error = await captureError(() =>
        runLeadbayPreview({
          state: loaded.state,
          manifest: manifest(),
          fixtureDir,
          triggeredBy: "leadbay-deploy preview",
          sessionFactory: async () => fake,
          bannerTimeoutMs: 10,
        }),
      );
      expect(error.exitCode).toBe(4);
      expect(
        fake.calls.filter((item) => item.name === "leadbay_set_qualification_questions"),
      ).toHaveLength(0);
      expect(fake.closed).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("makes no write when attestation has no mock banner", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "leadbay-safety-"));
    const fake = new FakeMcpSession({ readResult: readResult(), stderr: "server started\n" });
    try {
      const error = await captureError(() =>
        runLeadbayPreview({
          state: loaded.state,
          manifest: manifest(),
          fixtureDir,
          triggeredBy: "leadbay-deploy preview",
          sessionFactory: async () => fake,
          bannerTimeoutMs: 5,
          attestationParser: (context) => ({
            ...context.defaultAttestation,
            mock_banner: false,
            attested: false,
          }),
        }),
      );
      expect(error.exitCode).toBe(5);
      expect(
        fake.calls.filter((item) => item.name === "leadbay_set_qualification_questions"),
      ).toHaveLength(0);
      expect(fake.closed).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("rejects a non-reserved base URL before starting a process", async () => {
    let starts = 0;
    const error = await captureError(() =>
      runLeadbayPreview({
        state: loaded.state,
        manifest: manifest(),
        fixtureDir: "/tmp/unused",
        triggeredBy: "leadbay-deploy preview",
        baseUrl: "https://api-us.leadbay.app",
        sessionFactory: async () => {
          starts++;
          return new FakeMcpSession();
        },
      }),
    );
    expect(error.exitCode).toBe(5);
    expect(starts).toBe(0);
  });

  it("aborts before writes when stderr or results contain a production host", async () => {
    for (const fake of [
      new FakeMcpSession({
        readResult: readResult(),
        stderr: "[leadbay mock] loaded 4 fixtures; api-fr.leadbay.app\n",
      }),
      new FakeMcpSession({
        readResult: readResult(),
        resultMutator: (name, _input, result) =>
          name === "leadbay_get_qualification_questions"
            ? { ...(result as object), unsafe: "api-us.leadbay.app" }
            : result,
      }),
    ]) {
      const fixtureDir = mkdtempSync(join(tmpdir(), "leadbay-safety-"));
      try {
        const error = await captureError(() =>
          runLeadbayPreview({
            state: loaded.state,
            manifest: manifest(),
            fixtureDir,
            triggeredBy: "leadbay-deploy preview",
            sessionFactory: async () => fake,
            bannerTimeoutMs: 10,
          }),
        );
        expect(error.exitCode).toBe(5);
        expect(
          fake.calls.filter((item) => item.name === "leadbay_set_qualification_questions"),
        ).toHaveLength(0);
        expect(fake.closed).toBe(true);
      } finally {
        rmSync(fixtureDir, { recursive: true, force: true });
      }
    }
  });

  it("blocks an unacknowledged vetoed win before starting the MCP process", async () => {
    let starts = 0;
    const error = await captureError(() =>
      runLeadbayPreview({
        state: loaded.state,
        manifest: manifest(),
        fixtureDir: "/tmp/unused",
        triggeredBy: "leadbay-deploy preview",
        unacknowledgedVetoedWinIds: ["D-WON-INACTIVE"],
        sessionFactory: async () => {
          starts++;
          return new FakeMcpSession();
        },
      }),
    );
    expect(error.exitCode).toBe(3);
    expect(starts).toBe(0);
  });
});
