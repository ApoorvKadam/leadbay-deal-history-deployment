# Architecture

The code is split around the decisions that should not be allowed to blur together: loading customer data, learning from history, freezing a policy, evaluating it, and previewing account changes.

```text
brief + historical deals + prospects + Leadbay state
                     |
                 Case Loader
                     |
        Normalization / identity grouping
                     |
     grouped temporal split + predicates
                     |
       evidence + policy selection
                     |
        holdout evaluation + prospects
                     |
       artifacts + mock MCP preview
                     |
             approval package
```

## Case Loader

Files: `src/case/schema.ts`, `src/case/load-case.ts`

**Inputs:** A contained case directory with the customer brief, historical CSV, prospect CSV, canonical Leadbay state, and expected-policy contract.

**Outputs:** Runtime-validated `CustomerBrief`, `LeadbayState`, `ExpectedPolicy`, resolved paths, and loaded case metadata.

**Dependencies:** Shared errors and the ingestion parsers. This layer owns path containment, required files, configured columns, outcome mapping, and prohibited-column validation.

## Normalization Engine

Files: `src/ingestion/parse-csv.ts`, `domains.ts`, `normalize-row.ts`, `deduplicate.ts`

**Inputs:** RFC 4180 CSV rows and the brief's column map.

**Outputs:** Normalized deals and prospects with source-row provenance, duplicate diagnostics, and stable company identity groups.

**Dependencies:** Case contracts and shared errors only. Consumer mailboxes are not used as company domains. Conflicting rows for the same deal ID fail closed instead of choosing one.

## Predicate and Split Engine

Files: `src/analysis/predicates.ts`, `split.ts`

**Inputs:** Normalized rows, the supported predicate kinds, and grouped temporal split constraints.

**Outputs:** `true | false | unknown` predicate results and deterministic training/holdout membership.

**Dependencies:** Normalized records and brief predicates. Separate deals for the same company remain separate observations, but they always stay in the same partition.

## Evidence Engine

Files: `src/analysis/bootstrap.ts`, `evidence.ts`

**Inputs:** Training deals, candidate hypotheses, bootstrap seed and sample count, support thresholds, and prohibited fields.

**Outputs:** Smoothed win-rate effects, support and missingness diagnostics, company-cluster direction stability, candidate classifications, and evidence priority.

**Dependencies:** Predicate and split outputs. Bootstrap resampling happens at company-group level, so ten deals from one company do not become ten independent votes.

## Policy Builder

Files: `src/policy/question-rules.ts`, `select-policy.ts`, `manifest.ts`

**Inputs:** Evidence, the customer brief, labeled deals, current Leadbay state, and split metadata.

**Outputs:** Up to three ranked question additions, reserve signals, explicit brief-sourced anti-pattern additions, veto tradeoff diagnostics, and a fingerprinted `PolicyManifest`.

**Dependencies:** Evidence, predicate evaluation, stable hashing, and runtime schemas. This layer never removes an existing question and never derives a hard veto from correlation.

## Holdout Evaluator

Files: `src/evaluation/score-policy.ts`, `metrics.ts`

**Inputs:** The frozen manifest, held-out deals, current prospects, and explicit veto definitions.

**Outputs:** Transparent policy scores, coverage, top-bucket lift, false-positive and false-negative examples, unknowns, quality-gate results, and ranked prospects.

**Dependencies:** The manifest and tri-state predicates. These scores describe this local policy only. They are not Leadbay's proprietary score.

## Artifact Writer

Files: `src/reporting/artifacts.ts`, `markdown-report.ts`

**Inputs:** Case diagnostics, split, evidence, manifest, evaluation, prospect preview, and optional MCP artifacts.

**Outputs:** Formula-safe CSV, stable JSON, the 16-section report, a short summary, the complete artifact inventory, or a minimal failure package.

**Dependencies:** Stable serialization, redaction, runtime schemas, and atomic filesystem rename. A success directory only appears after all required artifacts validate.

## Leadbay MCP Preview Adapter

Files: `src/leadbay/build-mock-fixtures.ts`, `mcp-client.ts`, `preview-deployment.ts`, `trace.ts`

**Inputs:** Canonical Leadbay state, validated policy manifest, generated fixture directory, and a locked mock-only environment.

**Outputs:** Immutable mock fixtures, a safety attestation, a redacted tool trace, accepted tool inputs, and a projected, not persisted, organization state.

**Dependencies:** `@leadbay/mcp@0.40.0` and `@modelcontextprotocol/sdk@1.29.0`. The child environment is allowlisted. No mock write call runs before the read contract and safety attestation pass.

## CLI Orchestrator

Files: `src/commands.ts`, `src/cli.ts`

**Inputs:** `validate`, `analyze`, `preview`, or `demo`, plus contained case, output, and manifest paths.

**Outputs:** Stable success JSON, stable error JSON with exit codes 2 through 6, and atomic artifact packages.

**Dependencies:** The prior subsystems through explicit command dependencies. Tests can replace the MCP session boundary, but the analysis and artifact code stay the same.

## Shared Determinism and Safety

Files: `src/shared/errors.ts`, `stable-json.ts`, `redaction.ts`

**Inputs:** Errors, structured values, and artifact content.

**Outputs:** Stable error envelopes, recursively sorted JSON and hashes, PII, path, and token redaction, plus production-host rejection.

**Dependencies:** Node.js standard library only. Timestamps and durations are kept in operational traces and normalized in the curated example.
