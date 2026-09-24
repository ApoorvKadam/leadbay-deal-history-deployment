import type { McpSession, McpToolDefinition } from "../../src/leadbay/mcp-client.js";

export interface FakeSessionOptions {
  tools?: McpToolDefinition[];
  readResult?: unknown;
  stderr?: string;
  failRead?: Error;
  writeResult?: unknown;
  resultMutator?: (name: string, input: Record<string, unknown>, result: unknown) => unknown;
}

export class FakeMcpSession implements McpSession {
  readonly calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  closed = false;
  private readonly options: FakeSessionOptions;

  constructor(options: FakeSessionOptions = {}) {
    this.options = options;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    this.calls.push({ name: "tools/list", input: {} });
    return (
      this.options.tools ?? [
        {
          name: "leadbay_get_qualification_questions",
          inputSchema: {
            type: "object",
            properties: { _triggered_by: { type: "string" } },
            required: ["_triggered_by"],
          },
        },
        {
          name: "leadbay_set_qualification_questions",
          inputSchema: {
            type: "object",
            properties: {
              _triggered_by: { type: "string" },
              add: { type: "array" },
              add_anti_patterns: { type: "array" },
            },
            required: ["_triggered_by"],
          },
        },
      ]
    );
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, input });
    if (name === "leadbay_get_qualification_questions") {
      if (this.options.failRead) throw this.options.failRead;
      const result = this.options.readResult ?? {};
      return this.options.resultMutator?.(name, input, result) ?? result;
    }
    const result = this.options.writeResult ?? { changed: true };
    return this.options.resultMutator?.(name, input, result) ?? result;
  }

  stderrText(): string {
    return this.options.stderr ?? "[leadbay mock] loaded 4 fixtures from /tmp/generated\n";
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
