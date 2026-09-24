import { describe, expect, it } from "vitest";
import { parseCsvText } from "../../../src/ingestion/parse-csv.js";
import { AppError } from "../../../src/shared/errors.js";

describe("parseCsvText", () => {
  it("parses RFC 4180 quoted commas and assigns source row numbers after the header", () => {
    const parsed = parseCsvText('id,name\r\n1,"Acme, Inc."\r\n');
    expect(parsed.headers).toEqual(["id", "name"]);
    expect(parsed.rows[0]?.sourceRowNumber).toBe(2);
    expect(parsed.rows[0]?.values.name).toBe("Acme, Inc.");
  });

  it("preserves newlines inside quoted cells without losing the physical starting row", () => {
    const parsed = parseCsvText('id,notes\r\n1,"first\r\nsecond"\r\n2,plain\r\n');
    expect(parsed.rows[0]?.values.notes).toBe("first\r\nsecond");
    expect(parsed.rows[0]?.sourceRowNumber).toBe(2);
    expect(parsed.rows[1]?.sourceRowNumber).toBe(4);
  });

  it("rejects duplicate headers with a stable input error", () => {
    let error: unknown;
    try {
      parseCsvText("id,name,name\n1,a,b\n");
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof AppError).toBe(true);
    expect((error as AppError).code).toBe("CSV_HEADER_DUPLICATE");
    expect((error as AppError).exitCode).toBe(2);
  });

  it("rejects blank headers", () => {
    expect(() => parseCsvText("id,,name\n1,x,a\n")).toThrow(/blank header/i);
  });

  it("rejects unterminated quoted fields", () => {
    expect(() => parseCsvText('id,name\n1,"Acme\n')).toThrow(/unterminated/i);
  });

  it("rejects row/header column-count mismatches", () => {
    expect(() => parseCsvText("id,name\n1\n")).toThrow(/column count/i);
  });
});
