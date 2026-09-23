import type { RuntimeSchema } from "../case/schema.js";
import { assertNoProductionHost, redactForArtifact } from "../shared/redaction.js";

export interface LeadbayTraceItem {
  sequence: number;
  tool_name: string;
  input: unknown;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: "success" | "error";
  result?: unknown;
  error?: string;
  session_attested: boolean;
}

export interface LeadbayTrace {
  schema_version: "1.0";
  items: LeadbayTraceItem[];
  stderr: string;
}

function traceRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function traceString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function traceBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function traceNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function traceTimestamp(value: unknown, label: string): string {
  const result = traceString(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp.`);
  return result;
}

function parseTraceItem(value: unknown, index: number): LeadbayTraceItem {
  const label = `LeadbayTrace.items[${index}]`;
  const item = traceRecord(value, label);
  const sequence = traceNumber(item.sequence, `${label}.sequence`);
  if (!Number.isInteger(sequence) || sequence !== index + 1) {
    throw new Error(`${label}.sequence must be the contiguous one-based sequence.`);
  }
  const status = traceString(item.status, `${label}.status`);
  if (status !== "success" && status !== "error") {
    throw new Error(`${label}.status must be success or error.`);
  }
  const duration = traceNumber(item.duration_ms, `${label}.duration_ms`);
  if (duration < 0) throw new Error(`${label}.duration_ms must be nonnegative.`);
  const result: LeadbayTraceItem = {
    sequence,
    tool_name: traceString(item.tool_name, `${label}.tool_name`),
    input: item.input,
    started_at: traceTimestamp(item.started_at, `${label}.started_at`),
    ended_at: traceTimestamp(item.ended_at, `${label}.ended_at`),
    duration_ms: duration,
    status,
    session_attested: traceBoolean(item.session_attested, `${label}.session_attested`),
  };
  if (status === "success") {
    if (item.error !== undefined) throw new Error(`${label}.error is only valid for failures.`);
    if (item.result !== undefined) result.result = item.result;
  } else {
    result.error = traceString(item.error, `${label}.error`);
    if (item.result !== undefined) throw new Error(`${label}.result is only valid for successes.`);
  }
  return result;
}

export const LeadbayTraceSchema: RuntimeSchema<LeadbayTrace> = {
  parse(input: unknown): LeadbayTrace {
    const root = traceRecord(input, "LeadbayTrace");
    if (root.schema_version !== "1.0") {
      throw new Error("LeadbayTrace.schema_version must be 1.0.");
    }
    if (!Array.isArray(root.items)) throw new Error("LeadbayTrace.items must be an array.");
    return {
      schema_version: "1.0",
      items: root.items.map(parseTraceItem),
      stderr: traceString(root.stderr, "LeadbayTrace.stderr"),
    };
  },
};

export interface TraceRecorderOptions {
  now?: () => Date;
  monotonicNow?: () => number;
}

export class LeadbayTraceRecorder {
  readonly items: LeadbayTraceItem[] = [];
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;

  constructor(options: TraceRecorderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  async record<T>(
    toolName: string,
    input: unknown,
    sessionAttested: boolean,
    operation: () => Promise<T>,
  ): Promise<T> {
    assertNoProductionHost(input);
    const started = this.now();
    const startedMonotonic = this.monotonicNow();
    try {
      const result = await operation();
      assertNoProductionHost(result);
      const ended = this.now();
      const endedMonotonic = this.monotonicNow();
      this.items.push({
        sequence: this.items.length + 1,
        tool_name: toolName,
        input: redactForArtifact(input),
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        duration_ms: Math.max(0, endedMonotonic - startedMonotonic),
        status: "success",
        result: redactForArtifact(result),
        session_attested: sessionAttested,
      });
      return result;
    } catch (error) {
      const ended = this.now();
      const endedMonotonic = this.monotonicNow();
      const message = error instanceof Error ? error.message : String(error);
      assertNoProductionHost(message);
      this.items.push({
        sequence: this.items.length + 1,
        tool_name: toolName,
        input: redactForArtifact(input),
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        duration_ms: Math.max(0, endedMonotonic - startedMonotonic),
        status: "error",
        error: redactForArtifact(message),
        session_attested: sessionAttested,
      });
      throw error;
    }
  }

  toTrace(stderr: string): LeadbayTrace {
    assertNoProductionHost(stderr);
    return {
      schema_version: "1.0",
      items: this.items.map((item) => ({ ...item })),
      stderr: redactForArtifact(stderr),
    };
  }
}
