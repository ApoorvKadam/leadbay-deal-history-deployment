import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCase } from "../../../src/case/load-case.js";
import { AppError } from "../../../src/shared/errors.js";
import { makeBrief } from "../ingestion/helpers.js";

function writeCase(historical: string, prospects: string): string {
  const root = mkdtempSync(join(tmpdir(), "leadbay-ingestion-case-"));
  writeFileSync(join(root, "customer-brief.yaml"), JSON.stringify(makeBrief()));
  writeFileSync(join(root, "historical-deals.csv"), historical);
  writeFileSync(join(root, "current-prospects.csv"), prospects);
  writeFileSync(
    join(root, "leadbay-state.json"),
    JSON.stringify({
      schema_version: "1.0",
      region: "us",
      user: { id: "u", admin: true, organization: { id: 1, name: "Org" } },
      qualification_questions: [],
      ideal_buyer_profile: null,
      targeting_prompt: null,
    }),
  );
  return root;
}

const historyHeaders =
  "Deal ID,Company,Website,Contact Email,Location,Outcome,Loss Reason,Closed At,Revenue,Active,Sales Motion";
const prospectHeaders =
  "Deal ID,Company,Website,Contact Email,Location,Revenue,Active,Sales Motion";

describe("loadCase", () => {
  it("loads and normalizes both datasets into one complete case", () => {
    const root = writeCase(
      `${historyHeaders}\nD-1,Acme,acme.example,,Dallas,Won,,2026-01-01,100,true,Field Sales\n`,
      `${prospectHeaders}\nP-1,Prospect,prospect.example,,Denver,200,true,Field Sales\n`,
    );
    const loaded = loadCase(root);
    expect(loaded.ingestion.deals).toHaveLength(1);
    expect(loaded.ingestion.prospects).toHaveLength(1);
    expect(loaded.ingestion.deals[0]?.companyIdentityGroupId).toBe("domain:acme.example");
  });

  it("rejects a candidate column missing from current prospects", () => {
    const root = writeCase(
      `${historyHeaders}\nD-1,Acme,acme.example,,Dallas,Won,,2026-01-01,100,true,Field Sales\n`,
      "Deal ID,Company,Website,Contact Email,Location,Revenue,Active\nP-1,Prospect,prospect.example,,Denver,200,true\n",
    );
    let error: unknown;
    try {
      loadCase(root);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof AppError).toBe(true);
    expect((error as AppError).code).toBe("CASE_COLUMN_MISSING");
    expect((error as AppError).exitCode).toBe(2);
  });
});
