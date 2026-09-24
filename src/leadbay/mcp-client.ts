import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { AppError } from "../shared/errors.js";

export interface McpToolDefinition {
  name: string;
  inputSchema: Record<string, unknown>;
}

export interface McpSession {
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  stderrText(): string;
  close(): Promise<void>;
}

export interface McpSessionFactoryOptions {
  fixtureDir: string;
  environment: Record<string, string>;
  baseUrl: string;
}

export type McpSessionFactory = (options: McpSessionFactoryOptions) => Promise<McpSession>;

const REQUIRED_LEADBAY_VERSION = "0.40.0";
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

const SAFE_INHERITED_ENV_KEYS = new Set([
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
]);

export function buildMockEnvironment(
  fixtureDir: string,
  inherited: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined || !SAFE_INHERITED_ENV_KEYS.has(key.toUpperCase())) continue;
    environment[key] = value;
  }

  const sandboxHome = resolve(fixtureDir, ".home");
  const sandboxTemp = resolve(fixtureDir, ".tmp");
  const sandboxAppData = join(sandboxHome, "appdata", "roaming");
  const sandboxLocalAppData = join(sandboxHome, "appdata", "local");
  for (const directory of [sandboxHome, sandboxTemp, sandboxAppData, sandboxLocalAppData]) {
    mkdirSync(directory, { recursive: true });
  }

  const homeRoot = parse(sandboxHome).root;
  const homeDrive = homeRoot.replace(/[\\/]+$/, "");
  const homePath = homeDrive ? sandboxHome.slice(homeDrive.length) : sandboxHome;

  return {
    ...environment,
    HOME: sandboxHome,
    LOGNAME: "leadbay-mock",
    USER: "leadbay-mock",
    USERNAME: "leadbay-mock",
    USERPROFILE: sandboxHome,
    APPDATA: sandboxAppData,
    LOCALAPPDATA: sandboxLocalAppData,
    HOMEDRIVE: homeDrive,
    HOMEPATH: homePath,
    TEMP: sandboxTemp,
    TMP: sandboxTemp,
    TMPDIR: sandboxTemp,
    LEADBAY_MOCK: "1",
    LEADBAY_MOCK_DIR: resolve(fixtureDir),
    LEADBAY_MCP_WRITE: "1",
    LEADBAY_TELEMETRY_ENABLED: "false",
    LEADBAY_TOKEN: "synthetic-demo-token",
    LEADBAY_REGION: "us",
    LEADBAY_BASE_URL: "https://leadbay.invalid",
  };
}

export function resolveLeadbayBinary(
  requireFunction: NodeRequire = createRequire(import.meta.url),
): string {
  try {
    const packageJsonPath = requireFunction.resolve("@leadbay/mcp/package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    if (packageJson.version !== REQUIRED_LEADBAY_VERSION) {
      throw new AppError({
        code: "LEADBAY_PACKAGE_VERSION_MISMATCH",
        exitCode: 4,
        message: `Installed @leadbay/mcp version ${packageJson.version ?? "unknown"} does not match ${REQUIRED_LEADBAY_VERSION}.`,
        hint: "Install the exact reviewed package version before running the mock preview.",
      });
    }
    return join(dirname(packageJsonPath), "dist", "bin.js");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "LEADBAY_PACKAGE_UNAVAILABLE",
      exitCode: 4,
      message: "The pinned @leadbay/mcp package is not installed or cannot be resolved.",
      hint: "Run the exact frozen dependency install in a networked environment, then retry.",
      cause: error,
    });
  }
}

interface SdkTransport {
  stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): void };
  close?(): Promise<void>;
}

interface SdkClient {
  connect(transport: SdkTransport): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; inputSchema?: Record<string, unknown> }> }>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close?(): Promise<void>;
}

function extractStructuredContent(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    throw new Error("MCP tool returned a non-object result.");
  }
  const value = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (value.isError === true) {
    const message = value.content?.map((item) => item.text ?? "").join("\n") || "MCP tool failed.";
    throw new Error(message);
  }
  if (value.structuredContent !== undefined) return value.structuredContent;
  const text = value.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
  if (!text) throw new Error("MCP tool returned neither structuredContent nor JSON text content.");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("MCP text result was not valid JSON.", { cause: error });
  }
}

class RealMcpSession implements McpSession {
  private readonly client: SdkClient;
  private readonly transport: SdkTransport;
  private stderr = "";

  constructor(client: SdkClient, transport: SdkTransport) {
    this.client = client;
    this.transport = transport;
    transport.stderr?.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema ?? {},
    }));
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    return extractStructuredContent(await this.client.callTool({ name, arguments: input }));
  }

  stderrText(): string {
    return this.stderr;
  }

  async close(): Promise<void> {
    await this.client.close?.();
    await this.transport.close?.();
  }
}

export const createRealMcpSession: McpSessionFactory = async (options) => {
  const binPath = resolveLeadbayBinary();
  const clientModule = (await dynamicImport("@modelcontextprotocol/sdk/client/index.js")) as {
    Client: new (identity: { name: string; version: string }) => SdkClient;
  };
  const transportModule = (await dynamicImport("@modelcontextprotocol/sdk/client/stdio.js")) as {
    StdioClientTransport: new (options: {
      command: string;
      args: string[];
      env: Record<string, string>;
      stderr: "pipe";
    }) => SdkTransport;
  };
  const transport = new transportModule.StdioClientTransport({
    command: process.execPath,
    args: [binPath],
    env: options.environment,
    stderr: "pipe",
  });
  const client = new clientModule.Client({
    name: "leadbay-deal-history-deployment",
    version: "0.1.0",
  });
  await client.connect(transport);
  return new RealMcpSession(client, transport);
};
