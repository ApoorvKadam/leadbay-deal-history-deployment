export const STOPWORDS = new Set([
  "is",
  "the",
  "company",
  "likely",
  "to",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "with",
  "across",
]);

export type RuleSurface =
  | "existing_question"
  | "anti_pattern"
  | "targeting_prompt"
  | "lens_constraint"
  | "proposal";

export interface RuleText {
  surface: RuleSurface;
  text: string;
}

export interface DuplicateRuleMatch extends RuleText {
  similarity: number;
}

export interface QuestionValidation {
  valid: boolean;
  issues: string[];
}

export function normalizeRuleText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function ruleTokens(text: string): Set<string> {
  return new Set(
    normalizeRuleText(text)
      .split(" ")
      .filter((token) => token && !STOPWORDS.has(token)),
  );
}

export function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = ruleTokens(left);
  const rightTokens = ruleTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return leftTokens.size === 0 && rightTokens.size === 0 ? 1 : 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection++;
  return intersection / union.size;
}

export function rulesDuplicate(left: string, right: string): boolean {
  const normalizedLeft = normalizeRuleText(left);
  const normalizedRight = normalizeRuleText(right);
  return normalizedLeft === normalizedRight || jaccardSimilarity(left, right) >= 0.7;
}

export function findDuplicateRule(question: string, rules: RuleText[]): DuplicateRuleMatch | null {
  for (const rule of rules) {
    const similarity = jaccardSimilarity(question, rule.text);
    if (normalizeRuleText(question) === normalizeRuleText(rule.text) || similarity >= 0.7) {
      return { ...rule, similarity };
    }
  }
  return null;
}

export function validateQuestion(
  question: string,
  options: { language: string; customerName?: string },
): QuestionValidation {
  const issues: string[] = [];
  const trimmed = question.normalize("NFKC").trim();
  if (options.language !== "en") {
    issues.push("Version 1 validates English questions only.");
  } else if (!trimmed.toLocaleLowerCase("en-US").startsWith("is the company likely to ")) {
    issues.push('English questions must start with "Is the company likely to ".');
  }
  if (trimmed.length > 120) issues.push("Questions must contain at most 120 characters.");
  if (trimmed.length === 0) issues.push("Question text must not be empty.");

  const normalizedQuestion = normalizeRuleText(trimmed);
  if (options.customerName) {
    const normalizedCustomer = normalizeRuleText(options.customerName);
    if (normalizedCustomer && normalizedQuestion.includes(normalizedCustomer)) {
      issues.push("Questions must not include the named customer or another named company.");
    }
  }
  if (
    /\b(budget|confidential|roadmap|purchase intent|approved for (this )?purchase|internal plans?|plans? to buy|intends? to buy)\b/u.test(
      normalizedQuestion,
    )
  ) {
    issues.push("Questions must not claim internal budget, intent, or confidential plans.");
  }
  return { valid: issues.length === 0, issues };
}
