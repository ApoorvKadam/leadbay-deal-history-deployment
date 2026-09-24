import { z } from "zod";

export interface RuntimeSchema<T> {
  parse(input: unknown): T;
}

interface ZodBoundary<T> extends RuntimeSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

function schema<T>(label: string, parser: (input: unknown) => T): ZodBoundary<T> {
  return z.unknown().transform((input, context) => {
    try {
      return parser(input);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${label} validation failed: ${String(error)}`;
      context.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
  }) as ZodBoundary<T>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} must be a nonempty string.`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function stringArray(value: unknown, label: string, min = 0): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const values = value.map((item, index) => string(item, `${label}[${index}]`));
  if (values.length < min) throw new Error(`${label} must contain at least ${min} item(s).`);
  return values;
}

export type PredicateKind =
  | "boolean_is"
  | "categorical_in"
  | "contains_any"
  | "numeric_gte"
  | "numeric_lte"
  | "numeric_between"
  | "value_present";

export type CandidatePredicate =
  | { kind: "boolean_is"; favorable_value: boolean }
  | { kind: "categorical_in" | "contains_any"; favorable_values: string[] }
  | { kind: "numeric_gte" | "numeric_lte"; threshold: number }
  | { kind: "numeric_between"; min: number; max: number }
  | { kind: "value_present" };

export type VetoPredicate =
  | { kind: "boolean_is"; blocking_value: boolean }
  | { kind: "categorical_in" | "contains_any"; blocking_values: string[] }
  | { kind: "numeric_gte" | "numeric_lte"; threshold: number }
  | { kind: "numeric_between"; min: number; max: number }
  | { kind: "value_present" };

export type CandidateSignal = CandidatePredicate & {
  id: string;
  source_column: string;
  publicly_observable: true;
  question: string;
};

export type ExplicitVeto = VetoPredicate & {
  id: string;
  source_column: string;
  publicly_observable: true;
  anti_pattern: string;
  historical_win_tradeoff_acknowledged: boolean;
};

export interface CustomerBrief {
  schema_version: 1;
  case_id: string;
  customer: { name: string; country: string; language: string };
  business_goal: {
    summary: string;
    positive_outcomes: string[];
    negative_outcomes: string[];
  };
  analysis: {
    split_strategy: "grouped_temporal";
    holdout_fraction: number;
    bootstrap_seed: number;
    bootstrap_samples: number;
    minimum_labeled_deals: number;
    minimum_class_count: number;
    minimum_holdout_class_count: number;
  };
  columns: {
    record_id: string;
    company_name: string;
    website?: string;
    contact_email?: string;
    location?: string;
    outcome: string;
    loss_reason?: string;
    closed_at: string;
  };
  existing_lens_constraints: string[];
  candidate_signals: CandidateSignal[];
  explicit_vetoes: ExplicitVeto[];
  prohibited_columns: string[];
}

function parseQuestion(value: unknown): string {
  const question = string(value, "question");
  if (question.length > 120 || !question.startsWith("Is the company likely to ")) {
    throw new Error(
      'English questions must start "Is the company likely to " and stay under 120 characters.',
    );
  }
  return question;
}

function parseCandidatePredicate(value: Record<string, unknown>): CandidatePredicate {
  const kind = string(value.kind, "candidate kind") as PredicateKind;
  switch (kind) {
    case "boolean_is":
      return { kind, favorable_value: boolean(value.favorable_value, "favorable_value") };
    case "categorical_in":
    case "contains_any":
      return { kind, favorable_values: stringArray(value.favorable_values, "favorable_values", 1) };
    case "numeric_gte":
    case "numeric_lte":
      return { kind, threshold: finiteNumber(value.threshold, "threshold") };
    case "numeric_between": {
      const min = finiteNumber(value.min, "min");
      const max = finiteNumber(value.max, "max");
      if (min > max) throw new Error("numeric_between min must not exceed max.");
      return { kind, min, max };
    }
    case "value_present":
      return { kind };
    default:
      throw new Error(`Unsupported candidate predicate kind: ${kind}.`);
  }
}

function parseVetoPredicate(value: Record<string, unknown>): VetoPredicate {
  const kind = string(value.kind, "veto kind") as PredicateKind;
  switch (kind) {
    case "boolean_is":
      return { kind, blocking_value: boolean(value.blocking_value, "blocking_value") };
    case "categorical_in":
    case "contains_any":
      return { kind, blocking_values: stringArray(value.blocking_values, "blocking_values", 1) };
    case "numeric_gte":
    case "numeric_lte":
      return { kind, threshold: finiteNumber(value.threshold, "threshold") };
    case "numeric_between": {
      const min = finiteNumber(value.min, "min");
      const max = finiteNumber(value.max, "max");
      if (min > max) throw new Error("numeric_between min must not exceed max.");
      return { kind, min, max };
    }
    case "value_present":
      return { kind };
    default:
      throw new Error(`Unsupported veto predicate kind: ${kind}.`);
  }
}

function primitiveClass(kind: PredicateKind): "boolean" | "number" | "string" {
  if (kind === "boolean_is") return "boolean";
  if (kind.startsWith("numeric_")) return "number";
  return "string";
}

export const CustomerBriefSchema = schema<CustomerBrief>("CustomerBrief", (input) => {
  const root = record(input, "CustomerBrief");
  if (root.schema_version !== 1) throw new Error("CustomerBrief schema_version must be 1.");
  const customer = record(root.customer, "customer");
  const goal = record(root.business_goal, "business_goal");
  const analysis = record(root.analysis, "analysis");
  const columnsRaw = record(root.columns, "columns");
  const positive = stringArray(goal.positive_outcomes, "positive_outcomes", 1);
  const negative = stringArray(goal.negative_outcomes, "negative_outcomes", 1);
  const positiveKeys = new Set(positive.map((value) => value.trim().toLowerCase()));
  if (negative.some((value) => positiveKeys.has(value.trim().toLowerCase()))) {
    throw new Error("Positive and negative outcomes overlap.");
  }
  if (analysis.split_strategy !== "grouped_temporal") {
    throw new Error("analysis.split_strategy must be grouped_temporal.");
  }
  const holdoutFraction = finiteNumber(analysis.holdout_fraction, "holdout_fraction");
  if (!(holdoutFraction > 0 && holdoutFraction < 0.5)) {
    throw new Error("holdout_fraction must be greater than 0 and less than 0.5.");
  }
  const prohibited = stringArray(root.prohibited_columns ?? [], "prohibited_columns");
  const prohibitedKeys = new Set(prohibited.map((value) => value.trim().toLowerCase()));
  const automaticallyProhibitedKeys = new Set(
    [
      string(columnsRaw.outcome, "columns.outcome"),
      string(columnsRaw.closed_at, "columns.closed_at"),
      ...(columnsRaw.loss_reason === undefined
        ? []
        : [string(columnsRaw.loss_reason, "columns.loss_reason")]),
    ].map((value) => value.trim().toLowerCase()),
  );
  if (!Array.isArray(root.candidate_signals) || !Array.isArray(root.explicit_vetoes)) {
    throw new Error("candidate_signals and explicit_vetoes must be arrays.");
  }
  const candidates: CandidateSignal[] = root.candidate_signals.map((item, index) => {
    const value = record(item, `candidate_signals[${index}]`);
    const predicate = parseCandidatePredicate(value);
    if (value.publicly_observable !== true)
      throw new Error("Deployable rules must be publicly_observable: true.");
    return {
      id: string(value.id, "candidate id"),
      source_column: string(value.source_column, "candidate source_column"),
      publicly_observable: true,
      question: parseQuestion(value.question),
      ...predicate,
    } as CandidateSignal;
  });
  const vetoes: ExplicitVeto[] = root.explicit_vetoes.map((item, index) => {
    const value = record(item, `explicit_vetoes[${index}]`);
    const predicate = parseVetoPredicate(value);
    if (value.publicly_observable !== true)
      throw new Error("Deployable rules must be publicly_observable: true.");
    return {
      id: string(value.id, "veto id"),
      source_column: string(value.source_column, "veto source_column"),
      publicly_observable: true,
      anti_pattern: string(value.anti_pattern, "anti_pattern"),
      historical_win_tradeoff_acknowledged: boolean(
        value.historical_win_tradeoff_acknowledged,
        "historical_win_tradeoff_acknowledged",
      ),
      ...predicate,
    } as ExplicitVeto;
  });
  const ids = new Set<string>();
  const parserKinds = new Map<string, string>();
  for (const rule of [...candidates, ...vetoes]) {
    if (ids.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}.`);
    ids.add(rule.id);
    const sourceKey = rule.source_column.trim().toLowerCase();
    if (automaticallyProhibitedKeys.has(sourceKey)) {
      throw new Error(
        `Rule ${rule.id} uses mapped outcome or post-outcome column ${rule.source_column}.`,
      );
    }
    if (prohibitedKeys.has(sourceKey)) {
      throw new Error(`Rule ${rule.id} uses prohibited column ${rule.source_column}.`);
    }
    const current = primitiveClass(rule.kind);
    const previous = parserKinds.get(rule.source_column);
    if (previous && previous !== current) {
      throw new Error(
        `Source column ${rule.source_column} has incompatible primitive interpretations.`,
      );
    }
    parserKinds.set(rule.source_column, current);
  }
  const columns: CustomerBrief["columns"] = {
    record_id: string(columnsRaw.record_id, "columns.record_id"),
    company_name: string(columnsRaw.company_name, "columns.company_name"),
    outcome: string(columnsRaw.outcome, "columns.outcome"),
    closed_at: string(columnsRaw.closed_at, "columns.closed_at"),
  };
  for (const key of ["website", "contact_email", "location", "loss_reason"] as const) {
    const value = columnsRaw[key];
    if (value !== undefined) columns[key] = string(value, `columns.${key}`);
  }
  return {
    schema_version: 1,
    case_id: string(root.case_id, "case_id"),
    customer: {
      name: string(customer.name, "customer.name"),
      country: string(customer.country, "customer.country"),
      language: string(customer.language, "customer.language"),
    },
    business_goal: {
      summary: string(goal.summary, "business_goal.summary"),
      positive_outcomes: positive,
      negative_outcomes: negative,
    },
    analysis: {
      split_strategy: "grouped_temporal",
      holdout_fraction: holdoutFraction,
      bootstrap_seed: integer(analysis.bootstrap_seed, "bootstrap_seed"),
      bootstrap_samples: integer(analysis.bootstrap_samples, "bootstrap_samples"),
      minimum_labeled_deals: integer(analysis.minimum_labeled_deals, "minimum_labeled_deals"),
      minimum_class_count: integer(analysis.minimum_class_count, "minimum_class_count"),
      minimum_holdout_class_count: integer(
        analysis.minimum_holdout_class_count,
        "minimum_holdout_class_count",
      ),
    },
    columns,
    existing_lens_constraints: stringArray(
      root.existing_lens_constraints ?? [],
      "existing_lens_constraints",
    ),
    candidate_signals: candidates,
    explicit_vetoes: vetoes,
    prohibited_columns: prohibited,
  };
});

export interface LeadbayState {
  schema_version: "1.0";
  region: "us" | "fr";
  user: { id: string; admin: boolean; organization: { id: number; name: string } };
  qualification_questions: Array<{ question: string; lang: string }>;
  ideal_buyer_profile: null | {
    summary: string;
    key_characteristics: string[];
    anti_patterns: string[];
  };
  targeting_prompt: string | null;
}

export const LeadbayStateSchema = schema<LeadbayState>("LeadbayState", (input) => {
  const root = record(input, "LeadbayState");
  if (root.schema_version !== "1.0") throw new Error("LeadbayState schema_version must be 1.0.");
  if (root.region !== "us" && root.region !== "fr")
    throw new Error("LeadbayState region must be us or fr.");
  const user = record(root.user, "user");
  const org = record(user.organization, "user.organization");
  if (!Array.isArray(root.qualification_questions))
    throw new Error("qualification_questions must be an array.");
  if (root.qualification_questions.length > 5)
    throw new Error("Leadbay permits at most five qualification questions.");
  const questions = root.qualification_questions.map((item, index) => {
    const value = record(item, `qualification_questions[${index}]`);
    return { question: string(value.question, "question"), lang: string(value.lang, "lang") };
  });
  let profile: LeadbayState["ideal_buyer_profile"] = null;
  if (root.ideal_buyer_profile !== null) {
    const value = record(root.ideal_buyer_profile, "ideal_buyer_profile");
    profile = {
      summary: string(value.summary, "ideal_buyer_profile.summary"),
      key_characteristics: stringArray(value.key_characteristics ?? [], "key_characteristics"),
      anti_patterns: stringArray(value.anti_patterns ?? [], "anti_patterns"),
    };
  }
  return {
    schema_version: "1.0",
    region: root.region,
    user: {
      id: string(user.id, "user.id"),
      admin: boolean(user.admin, "user.admin"),
      organization: {
        id: integer(org.id, "organization.id"),
        name: string(org.name, "organization.name"),
      },
    },
    qualification_questions: questions,
    ideal_buyer_profile: profile,
    targeting_prompt:
      root.targeting_prompt === null ? null : string(root.targeting_prompt, "targeting_prompt"),
  };
});

export type HumanApproval =
  | "qualification_question_additions"
  | "ideal_buyer_profile_anti_pattern_additions";

export interface PolicyManifest {
  schema_version: "1.0";
  case_id: string;
  scenario: "synthetic";
  source_fingerprint: string;
  split: {
    strategy: "grouped_temporal";
    bootstrap_seed: number;
    training_rows: number;
    holdout_rows: number;
    holdout_cutoff_date: string;
  };
  leadbay_state: { existing_question_count: number; free_question_slots: number };
  question_additions: Array<{
    candidate_id: string;
    text: string;
    source: "historical_evidence";
    effect_pp: number;
    direction_stability: number;
    training_support: number;
  }>;
  reserve_signals: Array<Record<string, unknown>>;
  anti_pattern_additions: Array<{ veto_id: string; text: string; source: "customer_brief" }>;
  required_human_approvals: HumanApproval[];
}

function date(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed) || Number.isNaN(Date.parse(`${parsed}T00:00:00Z`))) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  return parsed;
}

export const PolicyManifestSchema = schema<PolicyManifest>("PolicyManifest", (input) => {
  const root = record(input, "PolicyManifest");
  if (root.schema_version !== "1.0") throw new Error("PolicyManifest schema_version must be 1.0.");
  if (root.scenario !== "synthetic") throw new Error("PolicyManifest scenario must be synthetic.");
  const fingerprint = string(root.source_fingerprint, "source_fingerprint");
  if (!fingerprint.startsWith("sha256:"))
    throw new Error("source_fingerprint must start with sha256:.");
  const splitRaw = record(root.split, "split");
  const stateRaw = record(root.leadbay_state, "leadbay_state");
  if (!Array.isArray(root.question_additions) || root.question_additions.length > 3) {
    throw new Error("question_additions may contain at most three questions.");
  }
  const existing = integer(stateRaw.existing_question_count, "existing_question_count");
  const free = integer(stateRaw.free_question_slots, "free_question_slots");
  if (existing + root.question_additions.length > 5)
    throw new Error("Existing plus added questions cannot exceed five.");
  if (free !== 5 - existing)
    throw new Error("free_question_slots must equal five minus existing questions.");
  const questionAdditions = root.question_additions.map((item, index) => {
    const value = record(item, `question_additions[${index}]`);
    if (value.source !== "historical_evidence")
      throw new Error("Question sources must be historical_evidence.");
    return {
      candidate_id: string(value.candidate_id, "candidate_id"),
      text: parseQuestion(value.text),
      source: "historical_evidence" as const,
      effect_pp: finiteNumber(value.effect_pp, "effect_pp"),
      direction_stability: finiteNumber(value.direction_stability, "direction_stability"),
      training_support: integer(value.training_support, "training_support"),
    };
  });
  if (!Array.isArray(root.reserve_signals)) throw new Error("reserve_signals must be an array.");
  if (!Array.isArray(root.anti_pattern_additions))
    throw new Error("anti_pattern_additions must be an array.");
  const antiPatterns = root.anti_pattern_additions.map((item, index) => {
    const value = record(item, `anti_pattern_additions[${index}]`);
    if (value.source !== "customer_brief")
      throw new Error("Every anti-pattern source must be customer_brief.");
    return {
      veto_id: string(value.veto_id, "veto_id"),
      text: string(value.text, "text"),
      source: "customer_brief" as const,
    };
  });
  const approvals = stringArray(root.required_human_approvals, "required_human_approvals").map(
    (value) => {
      if (
        value !== "qualification_question_additions" &&
        value !== "ideal_buyer_profile_anti_pattern_additions"
      ) {
        throw new Error(`Unsupported required approval: ${value}.`);
      }
      return value as HumanApproval;
    },
  );
  return {
    schema_version: "1.0",
    case_id: string(root.case_id, "case_id"),
    scenario: "synthetic",
    source_fingerprint: fingerprint,
    split: {
      strategy:
        splitRaw.strategy === "grouped_temporal"
          ? "grouped_temporal"
          : (() => {
              throw new Error("split.strategy must be grouped_temporal.");
            })(),
      bootstrap_seed: integer(splitRaw.bootstrap_seed, "bootstrap_seed"),
      training_rows: integer(splitRaw.training_rows, "training_rows"),
      holdout_rows: integer(splitRaw.holdout_rows, "holdout_rows"),
      holdout_cutoff_date: date(splitRaw.holdout_cutoff_date, "holdout_cutoff_date"),
    },
    leadbay_state: { existing_question_count: existing, free_question_slots: free },
    question_additions: questionAdditions,
    reserve_signals: root.reserve_signals.map((item, index) =>
      record(item, `reserve_signals[${index}]`),
    ),
    anti_pattern_additions: antiPatterns,
    required_human_approvals: approvals,
  };
});
