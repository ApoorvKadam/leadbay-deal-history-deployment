import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  type ArtifactCommandResult,
  type ValidateCommandResult,
  runAnalyze,
  runDemo,
  runPreview,
  runValidate,
} from "./commands.js";
import { AppError, asAppError } from "./shared/errors.js";
import { stableStringify } from "./shared/stable-json.js";

const USAGE = `Usage:
  leadbay-deploy validate --case <case-dir>
  leadbay-deploy analyze --case <case-dir> --out <output-dir>
  leadbay-deploy preview --case <case-dir> --manifest <policy-manifest.json> --out <output-dir>
  leadbay-deploy demo --case <case-dir> --out <output-dir>`;

type CommandResult = ValidateCommandResult | ArtifactCommandResult;

function cliError(code: string, message: string, hint: string): AppError {
  return new AppError({ code, exitCode: 2, message, hint });
}

function required(value: string | undefined, option: string): string {
  if (!value) {
    throw cliError("CLI_ARGUMENT_MISSING", `Missing required option --${option}.`, USAGE);
  }
  return value;
}

async function dispatch(argv: string[]): Promise<CommandResult> {
  const command = argv[0];
  if (!command) throw cliError("CLI_COMMAND_MISSING", "A command is required.", USAGE);
  if (!["validate", "analyze", "preview", "demo"].includes(command)) {
    throw cliError("CLI_COMMAND_INVALID", `Unknown command: ${command}.`, USAGE);
  }
  const options: Record<string, { type: "string" }> = {
    case: { type: "string" },
    ...(command === "analyze" || command === "demo" || command === "preview"
      ? { out: { type: "string" as const } }
      : {}),
    ...(command === "preview" ? { manifest: { type: "string" as const } } : {}),
  };
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({ args: argv.slice(1), options, strict: true, allowPositionals: false })
      .values as Record<string, string | undefined>;
  } catch (error) {
    throw new AppError({
      code: "CLI_ARGUMENT_INVALID",
      exitCode: 2,
      message: error instanceof Error ? error.message : String(error),
      hint: USAGE,
      cause: error,
    });
  }
  const caseDir = required(values.case, "case");
  switch (command) {
    case "validate":
      return runValidate({ caseDir });
    case "analyze":
      return runAnalyze({ caseDir, outDir: required(values.out, "out") });
    case "preview":
      return runPreview({
        caseDir,
        manifestPath: required(values.manifest, "manifest"),
        outDir: required(values.out, "out"),
      });
    case "demo":
      return runDemo({ caseDir, outDir: required(values.out, "out") });
    default:
      throw cliError("CLI_COMMAND_INVALID", `Unknown command: ${command}.`, USAGE);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const result = await dispatch(argv);
    process.stdout.write(stableStringify(result));
    return 0;
  } catch (error) {
    const app = asAppError(error);
    if (app.code === "CLI_COMMAND_MISSING" || app.code === "CLI_COMMAND_INVALID") {
      process.stderr.write(`${USAGE}\n`);
    }
    if (process.env.LEADBAY_DEPLOY_DEBUG === "1" && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.stderr.write(`${JSON.stringify(app.toJSON())}\n`);
    return app.exitCode;
  }
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === directEntry) {
  process.exitCode = await main();
}
