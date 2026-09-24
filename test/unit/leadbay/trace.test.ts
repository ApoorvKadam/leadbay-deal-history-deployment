import { describe, expect, it } from "vitest";
import { LeadbayTraceRecorder } from "../../../src/leadbay/trace.js";

describe("LeadbayTraceRecorder", () => {
  it("records stable sequence, timing, redacted input/result, and attestation state", async () => {
    const dates = [new Date("2026-09-22T12:00:00.000Z"), new Date("2026-09-22T12:00:00.025Z")];
    const monotonic = [100, 125];
    const trace = new LeadbayTraceRecorder({
      now: () => dates.shift()!,
      monotonicNow: () => monotonic.shift()!,
    });
    const result = await trace.record(
      "leadbay_set_qualification_questions",
      { authorization: "Bearer secret", email: "person@example.com" },
      true,
      async () => ({ phone: "+1 212 555 0199", changed: true }),
    );
    expect(result).toEqual({ phone: "+1 212 555 0199", changed: true });
    expect(trace.items).toEqual([
      {
        sequence: 1,
        tool_name: "leadbay_set_qualification_questions",
        input: { authorization: "Bearer ***", email: "***@example.com" },
        started_at: "2026-09-22T12:00:00.000Z",
        ended_at: "2026-09-22T12:00:00.025Z",
        duration_ms: 25,
        status: "success",
        result: { phone: "<PHONE>", changed: true },
        session_attested: true,
      },
    ]);
  });

  it("records a redacted error and rethrows it", async () => {
    const trace = new LeadbayTraceRecorder();
    await expect(
      trace.record("read", {}, false, async () => {
        throw new Error("Bearer secret failed for person@example.com");
      }),
    ).rejects.toThrow(/secret/);
    expect(trace.items[0]).toMatchObject({
      status: "error",
      error: "Bearer *** failed for ***@example.com",
      session_attested: false,
    });
  });
});
