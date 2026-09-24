import { describe, expect, it } from "vitest";
import {
  findDuplicateRule,
  jaccardSimilarity,
  normalizeRuleText,
  rulesDuplicate,
  validateQuestion,
} from "../../../src/policy/question-rules.js";

describe("validateQuestion", () => {
  it("requires the English estimative marker and a maximum of 120 characters", () => {
    expect(
      validateQuestion("Does the company operate field sales?", { language: "en" }).valid,
    ).toBe(false);
    expect(
      validateQuestion(`Is the company likely to ${"x".repeat(110)}?`, { language: "en" }).valid,
    ).toBe(false);
    expect(
      validateQuestion("Is the company likely to operate field-sales teams across territories?", {
        language: "en",
      }).valid,
    ).toBe(true);
  });

  it("rejects customer names and internal budget or confidential-plan claims", () => {
    expect(
      validateQuestion("Is the company likely to resemble Northstar Building Supply?", {
        language: "en",
        customerName: "Northstar Building Supply",
      }).issues.join(" "),
    ).toMatch(/named customer/i);
    expect(
      validateQuestion("Is the company likely to have budget approved for this purchase?", {
        language: "en",
      }).issues.join(" "),
    ).toMatch(/internal|budget/i);
    expect(
      validateQuestion("Is the company likely to have confidential expansion plans?", {
        language: "en",
      }).issues.join(" "),
    ).toMatch(/internal|confidential/i);
  });
});

describe("rule similarity", () => {
  it("normalizes Unicode, case, punctuation, and whitespace", () => {
    expect(normalizeRuleText("  FIELD–Sales, Teams! ")).toBe("field sales teams");
  });

  it("detects exact and token-Jaccard duplicates", () => {
    expect(rulesDuplicate("Field sales teams", "field-sales teams!")).toBe(true);
    expect(
      jaccardSimilarity(
        "Is the company likely to operate regional field sales teams?",
        "Does the company operate regional field sales teams?",
      ),
    ).toBeGreaterThanOrEqual(0.7);
    expect(
      rulesDuplicate(
        "Is the company likely to operate regional field sales teams?",
        "Does the company operate regional field sales teams?",
      ),
    ).toBe(true);
  });

  it("identifies duplicates across every current configuration surface", () => {
    const question = "Is the company likely to operate field-sales teams across territories?";
    for (const [surface, text] of [
      [
        "existing_question",
        "Is the company likely to operate field sales teams across territories?",
      ],
      ["anti_pattern", "Operate field sales teams territories"],
      ["targeting_prompt", "Prioritize operate field sales teams territories"],
      ["lens_constraint", "Operate field sales teams territories"],
      ["proposal", "Is the company likely to operate field sales teams across territories?"],
    ] as const) {
      expect(findDuplicateRule(question, [{ surface, text }])?.surface).toBe(surface);
    }
  });
});
