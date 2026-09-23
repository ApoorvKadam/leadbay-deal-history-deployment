import {
  type LeadbayState,
  LeadbayStateSchema,
  type PolicyManifest,
  type RuntimeSchema,
} from "../case/schema.js";
import { AppError } from "../shared/errors.js";
import { assertNoProductionHost } from "../shared/redaction.js";
import { stableStringify } from "../shared/stable-json.js";
import { type MockFixture, buildMockFixtures } from "./build-mock-fixtures.js";
import {
  type McpSession,
  type McpSessionFactory,
  type McpToolDefinition,
  buildMockEnvironment,
  createRealMcpSession,
} from "./mcp-client.js";
import { type LeadbayTrace, LeadbayTraceRecorder } from "./trace.js";

export interface MockSessionAttestation {
  mock_environment: boolean;
  invalid_base_url: boolean;
  mock_banner: boolean;
  fixture_backed_read: boolean;
  tool_contracts: boolean;
  no_production_hosts: boolean;
  attested: boolean;
}

export interface DeploymentPreview {
  schema_version: "1.0";
  status: "projected";
  persisted: false;
  accepted_tool_inputs: Array<{ name: string; input: Record<string, unknown> }>;
  starting_state: LeadbayState;
  projected_state: LeadbayState;
}

function previewRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function previewBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function previewString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

export const MockSessionAttestationSchema: RuntimeSchema<MockSessionAttestation> = {
  parse(input: unknown): MockSessionAttestation {
    const root = previewRecord(input, "MockSessionAttestation");
    return {
      mock_environment: previewBoolean(
        root.mock_environment,
        "MockSessionAttestation.mock_environment",
      ),
      invalid_base_url: previewBoolean(
        root.invalid_base_url,
        "MockSessionAttestation.invalid_base_url",
      ),
      mock_banner: previewBoolean(root.mock_banner, "MockSessionAttestation.mock_banner"),
      fixture_backed_read: previewBoolean(
        root.fixture_backed_read,
        "MockSessionAttestation.fixture_backed_read",
      ),
      tool_contracts: previewBoolean(root.tool_contracts, "MockSessionAttestation.tool_contracts"),
      no_production_hosts: previewBoolean(
        root.no_production_hosts,
        "MockSessionAttestation.no_production_hosts",
      ),
      attested: previewBoolean(root.attested, "MockSessionAttestation.attested"),
    };
  },
};

export const DeploymentPreviewSchema: RuntimeSchema<DeploymentPreview> = {
  parse(input: unknown): DeploymentPreview {
    const root = previewRecord(input, "DeploymentPreview");
    if (root.schema_version !== "1.0") {
      throw new Error("DeploymentPreview.schema_version must be 1.0.");
    }
    if (root.status !== "projected") {
      throw new Error("DeploymentPreview.status must be projected.");
    }
    if (root.persisted !== false) {
      throw new Error("DeploymentPreview.persisted must be false.");
    }
    if (!Array.isArray(root.accepted_tool_inputs)) {
      throw new Error("DeploymentPreview.accepted_tool_inputs must be an array.");
    }
    const acceptedToolInputs = root.accepted_tool_inputs.map((value, index) => {
      const item = previewRecord(value, `DeploymentPreview.accepted_tool_inputs[${index}]`);
      return {
        name: previewString(item.name, `DeploymentPreview.accepted_tool_inputs[${index}].name`),
        input: previewRecord(item.input, `DeploymentPreview.accepted_tool_inputs[${index}].input`),
      };
    });
    return {
      schema_version: "1.0",
      status: "projected",
      persisted: false,
      accepted_tool_inputs: acceptedToolInputs,
      starting_state: LeadbayStateSchema.parse(root.starting_state),
      projected_state: LeadbayStateSchema.parse(root.projected_state),
    };
  },
};

export interface LeadbayPreviewResult {
  fixtures: MockFixture[];
  attestation: MockSessionAttestation;
  trace: LeadbayTrace;
  preview: DeploymentPreview;
}

export interface AttestationParserContext {
  defaultAttestation: MockSessionAttestation;
  stderr: string;
  tools: McpToolDefinition[];
  readResult: QualificationStateResult;
  environment: Record<string, string>;
}

export type AttestationParser = (context: AttestationParserContext) => MockSessionAttestation;

export interface RunLeadbayPreviewInput {
  state: LeadbayState;
  manifest: PolicyManifest;
  fixtureDir: string;
  triggeredBy: string;
  baseUrl?: string;
  unacknowledgedVetoedWinIds?: string[];
  sessionFactory?: McpSessionFactory;
  attestationParser?: AttestationParser;
  bannerTimeoutMs?: number;
}

interface QualificationStateResult {
  qualification_questions: Array<{ question: string; lang?: string; created_at?: string }>;
  count: number;
  ideal_buyer_profile: LeadbayState["ideal_buyer_profile"];
  targeting_prompt: string | null;
  is_admin: boolean;
  region: string;
}

function mcpError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError({
    code: "LEADBAY_MCP_FAILURE",
    exitCode: 4,
    message: error instanceof Error ? error.message : String(error),
    hint: "Inspect the redacted MCP trace and generated fixtures, then retry with the pinned package.",
    cause: error,
  });
}

function safetyError(code: string, message: string, details?: unknown): AppError {
  return new AppError({
    code,
    exitCode: 5,
    message,
    hint: "No write preview was made. Restore the exact immutable mock-session invariant and retry.",
    ...(details === undefined ? {} : { details }),
  });
}

function properties(tool: McpToolDefinition): Record<string, unknown> {
  const schema = tool.inputSchema;
  const value = schema.properties;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredProperties(tool: McpToolDefinition): string[] {
  const value = tool.inputSchema.required;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return [];
  return value as string[];
}

function verifyTools(tools: McpToolDefinition[]): void {
  const read = tools.find((tool) => tool.name === "leadbay_get_qualification_questions");
  const write = tools.find((tool) => tool.name === "leadbay_set_qualification_questions");
  const readProperties = read ? properties(read) : {};
  const writeProperties = write ? properties(write) : {};
  const readRequired = read ? requiredProperties(read) : [];
  const writeRequired = write ? requiredProperties(write) : [];
  if (
    !read ||
    !write ||
    !("_triggered_by" in readProperties) ||
    !("_triggered_by" in writeProperties) ||
    !readRequired.includes("_triggered_by") ||
    !writeRequired.includes("_triggered_by") ||
    !("add" in writeProperties) ||
    !("add_anti_patterns" in writeProperties)
  ) {
    throw new AppError({
      code: "LEADBAY_TOOL_CONTRACT_MISMATCH",
      exitCode: 4,
      message: "The pinned Leadbay MCP does not expose the expected qualification tool contracts.",
      hint: "Verify @leadbay/mcp 0.39.10 and review any dependency update before proceeding.",
      details: { tool_names: tools.map((tool) => tool.name) },
    });
  }
}

function triggeredByValue(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError({
      code: "LEADBAY_TRIGGERED_BY_REQUIRED",
      exitCode: 4,
      message: "The Leadbay preview requires a nonempty command intent for MCP call provenance.",
      hint: "Pass the literal CLI command fragment that initiated this preview.",
    });
  }
  return value;
}

function qualificationResult(value: unknown): QualificationStateResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("leadbay_get_qualification_questions returned a non-object result.");
  }
  const result = value as Partial<QualificationStateResult>;
  if (
    !Array.isArray(result.qualification_questions) ||
    typeof result.count !== "number" ||
    typeof result.is_admin !== "boolean" ||
    typeof result.region !== "string" ||
    !("ideal_buyer_profile" in result) ||
    !("targeting_prompt" in result)
  ) {
    throw new Error("leadbay_get_qualification_questions returned an invalid result shape.");
  }
  return result as QualificationStateResult;
}

function stateComparableFromRead(value: QualificationStateResult): unknown {
  return {
    region: value.region,
    admin: value.is_admin,
    qualification_questions: value.qualification_questions.map((item) => ({
      question: item.question,
      lang: item.lang ?? "en",
    })),
    ideal_buyer_profile: value.ideal_buyer_profile,
    targeting_prompt: value.targeting_prompt,
  };
}

function stateComparable(state: LeadbayState): unknown {
  return {
    region: state.region,
    admin: state.user.admin,
    qualification_questions: state.qualification_questions,
    ideal_buyer_profile: state.ideal_buyer_profile,
    targeting_prompt: state.targeting_prompt,
  };
}

function verifyState(
  read: QualificationStateResult,
  state: LeadbayState,
  manifest: PolicyManifest,
): void {
  if (stableStringify(stateComparableFromRead(read)) !== stableStringify(stateComparable(state))) {
    throw new AppError({
      code: "LEADBAY_STATE_DRIFT",
      exitCode: 4,
      message: "Fixture-backed Leadbay state differs from leadbay-state.json.",
      hint: "Regenerate fixtures from the canonical state and do not coerce drift.",
      details: { expected: stateComparable(state), actual: stateComparableFromRead(read) },
    });
  }
  const existing = state.qualification_questions.length;
  if (
    read.count !== existing ||
    manifest.leadbay_state.existing_question_count !== existing ||
    manifest.leadbay_state.free_question_slots !== 5 - existing
  ) {
    throw new AppError({
      code: "LEADBAY_SLOT_ASSUMPTION_DRIFT",
      exitCode: 4,
      message: "The policy manifest no longer matches the canonical Leadbay question slots.",
      hint: "Re-run analysis from the same canonical Leadbay state before previewing.",
      details: {
        read_count: read.count,
        canonical_count: existing,
        manifest: manifest.leadbay_state,
      },
    });
  }
}

async function waitForBanner(session: McpSession, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  do {
    const stderr = session.stderrText();
    if (stderr.includes("[leadbay mock] loaded")) return stderr;
    await new Promise((resolve) => setTimeout(resolve, 2));
  } while (Date.now() < deadline);
  return session.stderrText();
}

function defaultAttestation(
  environment: Record<string, string>,
  stderr: string,
  toolContracts: boolean,
  fixtureBackedRead: boolean,
): MockSessionAttestation {
  const result = {
    mock_environment: environment.LEADBAY_MOCK === "1",
    invalid_base_url: environment.LEADBAY_BASE_URL === "https://leadbay.invalid",
    mock_banner: stderr.includes("[leadbay mock] loaded"),
    fixture_backed_read: fixtureBackedRead,
    tool_contracts: toolContracts,
    no_production_hosts: true,
    attested: false,
  };
  return {
    ...result,
    attested:
      result.mock_environment &&
      result.invalid_base_url &&
      result.mock_banner &&
      result.fixture_backed_read &&
      result.tool_contracts &&
      result.no_production_hosts,
  };
}

function validateWriteResult(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("leadbay_set_qualification_questions returned a non-object result.");
  }
  if ((value as { error?: unknown }).error === true) {
    throw new Error("leadbay_set_qualification_questions returned an error envelope.");
  }
}

function projectedState(state: LeadbayState, manifest: PolicyManifest): LeadbayState {
  const addedQuestions = manifest.question_additions.map((item) => ({
    question: item.text,
    lang: state.qualification_questions[0]?.lang ?? "en",
  }));
  let profile = state.ideal_buyer_profile;
  if (manifest.anti_pattern_additions.length > 0) {
    if (!profile) {
      throw new AppError({
        code: "LEADBAY_IBP_MISSING",
        exitCode: 4,
        message:
          "The canonical organization has no ideal buyer profile for anti-pattern additions.",
        hint: "Use a qualification question or create the buyer profile through an approved Leadbay workflow first.",
      });
    }
    profile = {
      ...profile,
      anti_patterns: [
        ...profile.anti_patterns,
        ...manifest.anti_pattern_additions
          .map((item) => item.text)
          .filter((text) => !profile?.anti_patterns.includes(text)),
      ],
    };
  }
  return {
    ...state,
    qualification_questions: [...state.qualification_questions, ...addedQuestions],
    ideal_buyer_profile: profile,
  };
}

export async function runLeadbayPreview(
  input: RunLeadbayPreviewInput,
): Promise<LeadbayPreviewResult> {
  if ((input.unacknowledgedVetoedWinIds ?? []).length > 0) {
    throw new AppError({
      code: "VETO_TRADEOFF_UNACKNOWLEDGED",
      exitCode: 3,
      message: "An explicit veto would exclude a historical win without acknowledged tradeoff.",
      hint: "Review the named historical wins before previewing any anti-pattern change.",
      details: { historical_win_ids: input.unacknowledgedVetoedWinIds },
    });
  }
  const baseUrl = input.baseUrl ?? "https://leadbay.invalid";
  if (baseUrl !== "https://leadbay.invalid") {
    throw safetyError(
      "LEADBAY_BASE_URL_UNSAFE",
      `Leadbay preview base URL must be exactly https://leadbay.invalid, not ${baseUrl}.`,
    );
  }

  const triggeredBy = triggeredByValue(input.triggeredBy);
  const fixtures = buildMockFixtures(input.state, input.fixtureDir);
  const environment = buildMockEnvironment(input.fixtureDir);
  const factory = input.sessionFactory ?? createRealMcpSession;
  const recorder = new LeadbayTraceRecorder();
  let session: McpSession | undefined;
  let result: LeadbayPreviewResult | undefined;
  let thrown: unknown;
  try {
    const activeSession = await factory({ fixtureDir: input.fixtureDir, environment, baseUrl });
    session = activeSession;
    const tools = await recorder.record("tools/list", {}, false, () => activeSession.listTools());
    verifyTools(tools);
    const readInput = { _triggered_by: triggeredBy };
    const rawRead = await recorder.record(
      "leadbay_get_qualification_questions",
      readInput,
      false,
      () => activeSession.callTool("leadbay_get_qualification_questions", readInput),
    );
    const read = qualificationResult(rawRead);
    verifyState(read, input.state, input.manifest);
    const stderr = await waitForBanner(activeSession, input.bannerTimeoutMs ?? 2_000);
    assertNoProductionHost(stderr);
    assertNoProductionHost(rawRead);
    const defaultValue = defaultAttestation(environment, stderr, true, true);
    const attestation = (input.attestationParser ?? ((context) => context.defaultAttestation))({
      defaultAttestation: defaultValue,
      stderr,
      tools,
      readResult: read,
      environment,
    });
    if (!attestation.attested) {
      throw safetyError(
        "LEADBAY_MOCK_ATTESTATION_FAILED",
        "The mock session did not satisfy every pre-write safety boundary.",
        {
          attestation,
        },
      );
    }

    const acceptedToolInputs: Array<{ name: string; input: Record<string, unknown> }> = [];
    if (input.manifest.anti_pattern_additions.length > 0) {
      const toolInput = {
        add_anti_patterns: input.manifest.anti_pattern_additions.map((item) => item.text),
      };
      const callInput = { ...toolInput, _triggered_by: triggeredBy };
      const writeResult = await recorder.record(
        "leadbay_set_qualification_questions",
        callInput,
        true,
        () => activeSession.callTool("leadbay_set_qualification_questions", callInput),
      );
      validateWriteResult(writeResult);
      acceptedToolInputs.push({ name: "leadbay_set_qualification_questions", input: toolInput });
    }
    if (input.manifest.question_additions.length > 0) {
      const toolInput = { add: input.manifest.question_additions.map((item) => item.text) };
      const callInput = { ...toolInput, _triggered_by: triggeredBy };
      const writeResult = await recorder.record(
        "leadbay_set_qualification_questions",
        callInput,
        true,
        () => activeSession.callTool("leadbay_set_qualification_questions", callInput),
      );
      validateWriteResult(writeResult);
      acceptedToolInputs.push({ name: "leadbay_set_qualification_questions", input: toolInput });
    }
    const preview: DeploymentPreview = {
      schema_version: "1.0",
      status: "projected",
      persisted: false,
      accepted_tool_inputs: acceptedToolInputs,
      starting_state: input.state,
      projected_state: projectedState(input.state, input.manifest),
    };
    result = {
      fixtures,
      attestation,
      trace: recorder.toTrace(stderr),
      preview,
    };
  } catch (error) {
    thrown = error;
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (closeError) {
        if (thrown === undefined) thrown = closeError;
      }
    }
  }
  if (thrown !== undefined) throw mcpError(thrown);
  if (result === undefined) {
    throw new AppError({
      code: "LEADBAY_PREVIEW_RESULT_MISSING",
      exitCode: 5,
      message: "Leadbay preview completed without producing a result.",
      hint: "Rerun the preview; this indicates an internal session lifecycle defect.",
    });
  }
  return result;
}
