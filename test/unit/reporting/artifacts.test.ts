import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter, renderCsv } from "../../../src/reporting/artifacts.js";
import { AppError } from "../../../src/shared/errors.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "leadbay-artifacts-"));
  roots.push(value);
  return value;
}

describe("renderCsv", () => {
  it("escapes formula strings without corrupting numeric negatives or RFC 4180 cells", () => {
    expect(
      renderCsv(
        [
          { formula: "=SUM(A1:A2)", amount: -12, note: 'comma, quote " and\nnewline', empty: "" },
          { formula: "+cmd", amount: 3, note: "plain", empty: null },
          { formula: "-not-a-number", amount: 0, note: "@mention", empty: "" },
        ],
        ["formula", "amount", "note", "empty"],
      ),
    ).toBe(
      "formula,amount,note,empty\r\n" +
        '\'=SUM(A1:A2),-12,"comma, quote "" and\nnewline",""\r\n' +
        "'+cmd,3,plain,\r\n" +
        "'-not-a-number,0,'@mention,\"\"\r\n",
    );
  });
});

describe("ArtifactWriter", () => {
  it("rejects a final directory that escapes the selected output root", () => {
    const outputRoot = root();
    expect(() =>
      ArtifactWriter.begin({
        outputRoot,
        finalDir: join(outputRoot, "..", "escaped"),
        caseId: "case",
        runId: "run",
      }),
    ).toThrow(AppError);
  });

  it("atomically renames one temporary directory into the final path", () => {
    const outputRoot = root();
    const finalDir = join(outputRoot, "case");
    const writer = ArtifactWriter.begin({ outputRoot, finalDir, caseId: "case", runId: "run" });
    const temporary = writer.temporaryDir;
    writer.writeText("summary.txt", "complete\n");
    const committed = writer.commit(["summary.txt"]);
    expect(committed).toBe(finalDir);
    expect(existsSync(temporary)).toBe(false);
    expect(readFileSync(join(finalDir, "summary.txt"), "utf8")).toBe("complete\n");
    expect(readdirSync(outputRoot).sort()).toEqual(["case"]);
  });

  it("restores the previous package when replacing it fails after staging", () => {
    const outputRoot = root();
    const finalDir = join(outputRoot, "case");
    mkdirSync(finalDir);
    writeFileSync(join(finalDir, "summary.txt"), "previous\n");
    let temporaryToFail = "";
    let failed = false;
    const begin = ArtifactWriter.begin as unknown as (
      options: Parameters<typeof ArtifactWriter.begin>[0],
      operations: {
        exists(path: string): boolean;
        remove(path: string): void;
        rename(source: string, target: string): void;
      },
    ) => ArtifactWriter;
    const writer = begin(
      { outputRoot, finalDir, caseId: "case", runId: "replace" },
      {
        exists: existsSync,
        remove: (path) => rmSync(path, { recursive: true, force: true }),
        rename: (source, target) => {
          if (!failed && source === temporaryToFail && target === finalDir) {
            failed = true;
            throw new Error("simulated rename failure");
          }
          renameSync(source, target);
        },
      },
    );
    temporaryToFail = writer.temporaryDir;
    writer.writeText("summary.txt", "replacement\n");
    expect(() => writer.commit(["summary.txt"])).toThrow(/artifact package|atomically/i);
    expect(readFileSync(join(finalDir, "summary.txt"), "utf8")).toBe("previous\n");
    expect(existsSync(writer.temporaryDir)).toBe(true);
  });

  it("blocks into a failure package without leaving a partial success directory", () => {
    const outputRoot = root();
    const finalDir = join(outputRoot, "case");
    const writer = ArtifactWriter.begin({ outputRoot, finalDir, caseId: "case", runId: "run-1" });
    writer.writeText("signal-evidence.json", "[]\n");
    const failureDir = writer.block(
      new AppError({
        code: "EVIDENCE_BLOCKED",
        exitCode: 3,
        message: "Blocked",
        hint: "Review evidence",
      }),
    );
    expect(existsSync(finalDir)).toBe(false);
    expect(failureDir).toBe(join(outputRoot, ".failed", "case", "run-1"));
    expect(existsSync(join(failureDir, "signal-evidence.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(failureDir, "failure.json"), "utf8"))).toMatchObject({
      error: true,
      code: "EVIDENCE_BLOCKED",
      exit_code: 3,
    });
  });

  it("writes only a minimal stable failure package for an unexpected write failure", () => {
    const outputRoot = root();
    const finalDir = join(outputRoot, "case");
    const writer = ArtifactWriter.begin({ outputRoot, finalDir, caseId: "case", runId: "run-2" });
    writer.writeText("partial.txt", "must not survive\n");
    const failureDir = writer.fail(new Error("disk stopped"));
    expect(readdirSync(failureDir).sort()).toEqual(["failure.json"]);
    expect(existsSync(finalDir)).toBe(false);
  });
});
