import { homedir, tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/shared/errors.js";
import { assertNoProductionHost, redactForArtifact } from "../../../src/shared/redaction.js";

describe("redactForArtifact", () => {
  it("redacts bearer tokens, email local parts, phones, home paths, and temp paths", () => {
    const value = {
      authorization: "Bearer synthetic-secret-token",
      contact: "person@example.com",
      note: `Call +1 (212) 555-0199; read ${homedir()}/private.txt; temp ${tmpdir()}/case/run.json`,
    };
    expect(redactForArtifact(value)).toEqual({
      authorization: "Bearer ***",
      contact: "***@example.com",
      note: "Call <PHONE>; read <HOME>/private.txt; temp <TMP>/case/run.json",
    });
  });

  it("normalizes Unicode before redacting", () => {
    expect(redactForArtifact("Ｂｅａｒｅｒ　secret person＠example.com")).toBe(
      "Bearer *** ***@example.com",
    );
  });

  it("preserves ISO dates while still redacting hyphenated phone numbers", () => {
    expect(redactForArtifact("cutoff 2025-01-01; call 212-555-0199")).toBe(
      "cutoff 2025-01-01; call <PHONE>",
    );
  });
});

describe("assertNoProductionHost", () => {
  it("throws a safety error for either production Leadbay API host", () => {
    for (const text of [
      "https://api-us.leadbay.app/1.6/users/me",
      "stderr: ａｐｉ－ｆｒ．ｌｅａｄｂａｙ．ａｐｐ",
    ]) {
      let error: unknown;
      try {
        assertNoProductionHost(text);
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof AppError).toBe(true);
      expect((error as AppError).exitCode).toBe(5);
      expect((error as AppError).code).toBe("PRODUCTION_LEADBAY_HOST_DETECTED");
    }
  });
});
