export type ExitCode = 2 | 3 | 4 | 5 | 6;

export interface AppErrorInput {
  code: string;
  exitCode: ExitCode;
  message: string;
  hint: string;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly hint: string;
  readonly details?: unknown;

  constructor(input: AppErrorInput) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "AppError";
    this.code = input.code;
    this.exitCode = input.exitCode;
    this.hint = input.hint;
    this.details = input.details;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      exit_code: this.exitCode,
      message: this.message,
      hint: this.hint,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function asAppError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError({
        code: "UNEXPECTED_ERROR",
        exitCode: 6,
        message: error instanceof Error ? error.message : String(error),
        hint: "Inspect the failure artifact and rerun after correcting the underlying error.",
        cause: error,
      });
}
