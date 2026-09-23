import { describe, expect, it } from "vitest";
import { normalizeDealRows, normalizeProspectRows } from "../../../src/ingestion/normalize-row.js";
import { parseCsvText } from "../../../src/ingestion/parse-csv.js";
import { makeBrief } from "./helpers.js";

const headers = [
  "Deal ID",
  "Company",
  "Website",
  "Contact Email",
  "Location",
  "Outcome",
  "Loss Reason",
  "Closed At",
  "Revenue",
  "Active",
  "Sales Motion",
].join(",");

describe("normalizeDealRows", () => {
  it("keeps missing values unknown and records invalid numeric input as a warning", () => {
    const parsed = parseCsvText(
      `${headers}\nD-1,  Acme   Supply  ,,, Dallas ,Won,,2026-01-02,not-a-number,yes, Field Sales \n`,
    );
    const [deal] = normalizeDealRows(parsed.rows, makeBrief());
    expect(deal?.normalizedCompanyName).toBe("acme supply");
    expect(deal?.normalizedLocation).toBe("dallas");
    expect(deal?.fields.Revenue).toBeNull();
    expect(deal?.fields.Active).toBe(true);
    expect(deal?.fields["Sales Motion"]).toBe("field sales");
    expect(deal?.warnings.join(" ")).toMatch(/Revenue.*finite number/i);
  });

  it("prefers website identity over an unrelated business-email domain", () => {
    const parsed = parseCsvText(
      `${headers}\nD-2,Acme,https://www.acme.example/path,person@other.example,Austin,Lost,No fit,2026-02-03,200,no,Inside Sales\n`,
    );
    const [deal] = normalizeDealRows(parsed.rows, makeBrief());
    expect(deal?.canonicalDomain).toBe("acme.example");
    expect(deal?.domainSource).toBe("website");
    expect(JSON.stringify(deal)).not.toContain("person@other.example");
  });

  it("uses a non-consumer business email when the website is absent", () => {
    const parsed = parseCsvText(
      `${headers}\nD-3,Northstar,,owner@northstar-supply.co.uk,Leeds,Won,,2026-03-04,120,true,Field Sales\n`,
    );
    const [deal] = normalizeDealRows(parsed.rows, makeBrief());
    expect(deal?.canonicalDomain).toBe("northstar-supply.co.uk");
    expect(deal?.domainSource).toBe("business_email");
    expect(JSON.stringify(deal)).not.toContain("owner@");
  });

  it("maps configured outcomes and ISO-normalizes parseable close dates", () => {
    const parsed = parseCsvText(`${headers}\nD-4,Acme,,,,lost,,March 5 2026,100,0,Inside Sales\n`);
    const [deal] = normalizeDealRows(parsed.rows, makeBrief());
    expect(deal?.outcome).toBe("negative");
    expect(deal?.closeDate).toBe("2026-03-05");
  });
});

describe("normalizeProspectRows", () => {
  it("normalizes prospects without requiring outcomes or dates", () => {
    const parsed = parseCsvText(
      "Deal ID,Company,Website,Contact Email,Location,Revenue,Active,Sales Motion\nP-1,Prospect,prospect.example,,Denver,150,true,Field Sales\n",
    );
    const [prospect] = normalizeProspectRows(parsed.rows, makeBrief());
    expect(prospect?.sourceRecordId).toBe("P-1");
    expect(prospect?.canonicalDomain).toBe("prospect.example");
    expect(prospect?.fields.Revenue).toBe(150);
    expect(JSON.stringify(prospect)).not.toContain("Contact Email");
  });
});
