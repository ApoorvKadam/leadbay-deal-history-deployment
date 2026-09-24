import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/shared/errors.js";

describe("AppError", () => {
  it("preserves a stable code, exit code, hint, and details", () => {
    const error = new AppError({
      code: "CASE_INVALID",
      exitCode: 2,
      message: "Case validation failed",
      hint: "Fix customer-brief.yaml",
      details: { field: "case_id" },
    });
    expect(error.toJSON()).toEqual({
      error: true,
      code: "CASE_INVALID",
      exit_code: 2,
      message: "Case validation failed",
      hint: "Fix customer-brief.yaml",
      details: { field: "case_id" },
    });
  });
});
