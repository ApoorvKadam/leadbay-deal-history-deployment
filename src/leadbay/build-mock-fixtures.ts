import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LeadbayState } from "../case/schema.js";
import { stableStringify } from "../shared/stable-json.js";

export interface MockFixture {
  request: { method: "GET"; url: string };
  response: {
    status: 200;
    headers: { "content-type": "application/json" };
    body: unknown;
  };
}

function fixture(url: string, body: unknown): MockFixture {
  return {
    request: { method: "GET", url },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body,
    },
  };
}

export function buildMockFixtures(state: LeadbayState, fixtureDir: string): MockFixture[] {
  const root = resolve(fixtureDir);
  mkdirSync(root, { recursive: true });
  for (const name of readdirSync(root)) {
    if (name.endsWith(".json")) rmSync(join(root, name), { force: true });
  }
  const base = "https://leadbay.invalid/1.6";
  const orgId = state.user.organization.id;
  const fixtures = [
    fixture(`${base}/users/me`, {
      id: state.user.id,
      admin: state.user.admin,
      organization: state.user.organization,
      telemetry_enabled: false,
    }),
    fixture(
      `${base}/organizations/${orgId}/ai_agent_questions`,
      state.qualification_questions.map((item, index) => ({
        question: item.question,
        lang: item.lang,
        created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      })),
    ),
    fixture(`${base}/organizations/${orgId}/ideal_buyer_profile`, state.ideal_buyer_profile),
    fixture(`${base}/organizations/${orgId}/user_prompt`, { prompt: state.targeting_prompt }),
  ];
  fixtures.forEach((item, index) => {
    writeFileSync(
      join(root, `${String(index + 1).padStart(2, "0")}-fixture.json`),
      stableStringify(item),
      "utf8",
    );
  });
  return fixtures;
}
