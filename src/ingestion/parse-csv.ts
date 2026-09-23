import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { AppError } from "../shared/errors.js";

export interface ParsedCsvRow {
  sourceRowNumber: number;
  values: Record<string, string>;
}

export interface ParsedCsv {
  headers: string[];
  rows: ParsedCsvRow[];
}

function csvError(
  code: string,
  message: string,
  hint: string,
  details?: unknown,
  cause?: unknown,
): AppError {
  return new AppError({
    code,
    exitCode: 2,
    message,
    hint,
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function physicalRecordStartRows(text: string): number[] {
  const starts: number[] = [];
  let line = 1;
  let recordStart = 1;
  let recordHasContent = false;
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      recordHasContent = true;
      if (quoted && text[index + 1] === '"') {
        index++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (!quoted && recordHasContent) starts.push(recordStart);
      line++;
      if (!quoted) {
        recordStart = line;
        recordHasContent = false;
      }
      if (character === "\r" && text[index + 1] === "\n") index++;
      continue;
    }
    recordHasContent = true;
  }
  if (recordHasContent) starts.push(recordStart);
  return starts;
}

function validateHeaders(rawHeaders: string[], sourceName: string): string[] {
  const headers = rawHeaders.map((header) => header.normalize("NFKC").trim());
  const blankIndex = headers.findIndex((header) => header === "");
  if (blankIndex !== -1) {
    throw csvError(
      "CSV_HEADER_EMPTY",
      `${sourceName} contains a blank header at column ${blankIndex + 1}.`,
      "Give every CSV column a stable, nonempty name.",
      { column: blankIndex + 1 },
    );
  }
  const seen = new Map<string, number>();
  for (const [index, header] of headers.entries()) {
    const key = header.toLocaleLowerCase("en-US");
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw csvError(
        "CSV_HEADER_DUPLICATE",
        `${sourceName} contains duplicate header "${header}".`,
        "Rename duplicate columns before analysis; ambiguous mappings are never guessed.",
        { header, columns: [previous + 1, index + 1] },
      );
    }
    seen.set(key, index);
  }
  return headers;
}

export function parseCsvText(text: string, sourceName = "CSV input"): ParsedCsv {
  let headers: string[] = [];
  try {
    const records = parse(text, {
      bom: true,
      columns(rawHeaders) {
        headers = validateHeaders(rawHeaders, sourceName);
        return headers;
      },
      relax_column_count: false,
      skip_empty_lines: true,
      trim: false,
    }) as Array<Record<string, string>>;
    if (headers.length === 0) {
      throw csvError(
        "CSV_HEADER_MISSING",
        `${sourceName} has no header row.`,
        "Add a nonempty RFC 4180 header row before the data.",
      );
    }
    const sourceRows = physicalRecordStartRows(text).slice(1);
    const rows = records.map((record, index) => {
      const sourceRowNumber = sourceRows[index];
      if (sourceRowNumber === undefined) {
        throw csvError(
          "CSV_SOURCE_ROW_MISSING",
          `${sourceName} record ${index + 1} has no physical source row.`,
          "Re-read the CSV; this indicates an internal record-position defect.",
          { record: index + 1 },
        );
      }
      return { sourceRowNumber, values: record };
    });
    return { headers, rows };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const parserError = error as {
      code?: string;
      message?: string;
      lines?: number;
      record?: unknown[];
    };
    if (parserError.code === "CSV_QUOTE_NOT_CLOSED") {
      throw csvError(
        "CSV_QUOTE_UNTERMINATED",
        `${sourceName} contains an unterminated quoted field.`,
        "Close the quoted field and escape embedded quotes as doubled quotes.",
        { source_row: parserError.lines ?? null },
        error,
      );
    }
    if (parserError.code === "CSV_RECORD_INCONSISTENT_COLUMNS") {
      throw csvError(
        "CSV_COLUMN_COUNT_MISMATCH",
        `${sourceName} row ${parserError.lines ?? "unknown"} has a column count that does not match the header.`,
        "Repair unescaped commas, quotes, or missing cells so every row matches the header column count.",
        {
          source_row: parserError.lines ?? null,
          actual_columns: parserError.record?.length ?? null,
        },
        error,
      );
    }
    throw csvError(
      "CSV_PARSE_INVALID",
      `${sourceName} is not valid RFC 4180 CSV: ${parserError.message ?? String(error)}`,
      "Repair quoting and delimiters before analysis.",
      undefined,
      error,
    );
  }
}

export function parseCsvFile(path: string): ParsedCsv {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw csvError(
      "CSV_READ_FAILED",
      `Unable to read CSV file: ${path}`,
      "Check that the case file exists and is readable.",
      { file: path },
      error,
    );
  }
  return parseCsvText(text, path);
}
