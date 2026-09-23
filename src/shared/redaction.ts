import { homedir, tmpdir } from "node:os";
import { AppError } from "./errors.js";

const PRODUCTION_HOST = /\bapi-(?:us|fr)\.leadbay\.app\b/i;
const EMAIL = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const BEARER = /\bBearer\s+[A-Z0-9._~+/=-]+/gi;
const NAMED_SECRET = /\b((?:LEADBAY_)?(?:TOKEN|PASSWORD|SECRET|API_KEY)\s*[=:]\s*)[^\s,;]+/gi;
const PHONE = /(?<![\p{L}\p{N}])\+?\d[\d ().-]{7,}\d(?![\p{L}\p{N}])/gu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizedText(value: string): string {
  return value.normalize("NFKC");
}

function escaped(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
}

export function assertNoProductionHost(value: unknown): void {
  const text = normalizedText(typeof value === "string" ? value : JSON.stringify(value));
  const match = text.match(PRODUCTION_HOST);
  if (match) {
    throw new AppError({
      code: "PRODUCTION_LEADBAY_HOST_DETECTED",
      exitCode: 5,
      message: `A production Leadbay hostname was detected: ${match[0]}.`,
      hint: "Stop the preview. Verify LEADBAY_MOCK=1 and the exact https://leadbay.invalid base URL before any tool call.",
      details: { hostname: match[0].toLowerCase() },
    });
  }
}

export interface RedactionOptions {
  homeDir?: string;
  tempDir?: string;
}

function redactText(value: string, options: RedactionOptions): string {
  let text = normalizedText(value);
  const home = normalizedText(options.homeDir ?? homedir()).replace(/\/+$/, "");
  const temp = normalizedText(options.tempDir ?? tmpdir()).replace(/\/+$/, "");
  text = text.replace(BEARER, "Bearer ***");
  text = text.replace(NAMED_SECRET, "$1***");
  text = text.replace(EMAIL, "***@$1");
  text = text.replace(PHONE, (match) => (ISO_DATE.test(match) ? match : "<PHONE>"));
  if (home) text = text.replace(escaped(home), "<HOME>");
  if (temp) text = text.replace(escaped(temp), "<TMP>");
  return text;
}

export function redactForArtifact<T>(value: T, options: RedactionOptions = {}): T {
  if (typeof value === "string") return redactText(value, options) as T;
  if (Array.isArray(value)) {
    return value.map((item) => redactForArtifact(item, options)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        redactForArtifact(child, options),
      ]),
    ) as T;
  }
  return value;
}
