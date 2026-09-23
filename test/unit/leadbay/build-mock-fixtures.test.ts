import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCase } from "../../../src/case/load-case.js";
import { buildMockFixtures } from "../../../src/leadbay/build-mock-fixtures.js";

describe("buildMockFixtures", () => {
  it("generates exactly four immutable GET fixtures from canonical state", () => {
    const root = mkdtempSync(join(tmpdir(), "leadbay-mock-fixtures-"));
    try {
      const state = loadCase("fixtures/building-materials-distributor").state;
      const generated = buildMockFixtures(state, root);
      expect(generated.map((item) => item.request.url)).toEqual([
        "https://leadbay.invalid/1.6/users/me",
        "https://leadbay.invalid/1.6/organizations/4242/ai_agent_questions",
        "https://leadbay.invalid/1.6/organizations/4242/ideal_buyer_profile",
        "https://leadbay.invalid/1.6/organizations/4242/user_prompt",
      ]);
      expect(readdirSync(root).sort()).toHaveLength(4);
      for (const file of readdirSync(root)) {
        const fixture = JSON.parse(readFileSync(join(root, file), "utf8"));
        expect(fixture.request.method).toBe("GET");
        expect(fixture.response.status).toBe(200);
        expect(fixture.response.headers).toEqual({ "content-type": "application/json" });
      }
      expect(Array.isArray(generated[1]?.response.body)).toBe(true);
      expect(generated[3]?.response.body).toEqual({ prompt: state.targeting_prompt });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
