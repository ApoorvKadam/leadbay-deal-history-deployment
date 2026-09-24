import { describe, expect, it } from "vitest";
import { canonicalizeWebsite, deriveBusinessDomain } from "../../../src/ingestion/domains.js";

describe("canonicalizeWebsite", () => {
  it("reduces a URL to a lowercased registrable domain", () => {
    expect(canonicalizeWebsite(" HTTPS://WWW.Example.COM:443/path?q=1 ")).toBe("example.com");
  });

  it("handles bare hosts and common multi-label public suffixes", () => {
    expect(canonicalizeWebsite("portal.northstar-supply.co.uk/catalog")).toBe(
      "northstar-supply.co.uk",
    );
  });

  it("rejects malformed or non-http host input", () => {
    expect(canonicalizeWebsite("not a host")).toBeNull();
    expect(canonicalizeWebsite("mailto:person@example.com")).toBeNull();
  });
});

describe("deriveBusinessDomain", () => {
  it("rejects consumer mailbox domains without retaining the local part", () => {
    expect(deriveBusinessDomain("owner@gmail.com")).toEqual({
      domain: null,
      rejectedConsumer: true,
    });
  });

  it("returns the registrable domain for a business mailbox", () => {
    expect(deriveBusinessDomain("sales@northstar-supply.co.uk")).toEqual({
      domain: "northstar-supply.co.uk",
      rejectedConsumer: false,
    });
  });

  it("returns no domain for malformed addresses", () => {
    expect(deriveBusinessDomain("not-an-email")).toEqual({
      domain: null,
      rejectedConsumer: false,
    });
  });
});
