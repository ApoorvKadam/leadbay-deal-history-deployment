# Synthetic deployment case: regional building-materials distribution

## Scenario

Northstar Building Supply is fictional. The scenario is a regional building-materials distributor that sells through territory teams to contractors and local business networks.

The job is simple to state and harder to do well: take a messy history of won and lost deals and decide which observable traits are strong enough to become Leadbay qualification questions.

Every committed record is synthetic. The generated data uses seed `20260922` and deliberately plants recoverable signal plus decoy structure. The customer brief is hand-authored. The separate `expected-policy.json` file is a test oracle only; the CLI never loads it.

The synthetic result tests whether the pipeline recovers the structure it was designed to recover and rejects the decoys. It does not establish that Leadbay will answer the resulting questions from public text in the same way the CRM fields are labeled. In a real engagement, I would qualify the historical companies through Leadbay and compare Leadbay's own per-question responses with won/lost outcomes before changing the account.

## What is in the export

After one exact duplicate export is collapsed, the history contains 80 labeled deals across at least 70 company identity groups.

The file includes:

- repeat opportunities for the same company
- inconsistent website formats
- business and consumer email domains
- missing values
- noisy categorical labels
- prohibited post-outcome columns

A separate failure fixture has conflicting rows for the same deal ID. That case must fail instead of quietly choosing one row.

The holdout uses the newest company groups. One company never appears on both sides of the split. Bootstrap resampling also happens by company group.

The current-prospect file includes a strong fit, a partial fit with an unknown value, a consumer-mailbox case, a weak single-location company, and an inactive company.

## Signals that make the policy

The policy can select at most three eligible hypotheses:

- `multi_territory_field_sales`: evidence of a territory or field-sales motion
- `fragmented_smb_market`: selling B2B into fragmented small-business markets
- `crm_exportability`: likely use of a CRM or ERP that can export deal history

The manifest keeps support, smoothed effect, direction stability, source column, and the exact question text. Ranking follows evidence priority. Tests compare the finished runtime output with the hand-authored oracle afterward; the oracle is not a deployment input.

## Signals that do not make it

The point of the case is not to make every hypothesis win.

- `enterprise_scale` is `contradicted`. The observed direction is opposite the hypothesis.
- `recent_funding` is `high_missingness`. Too much of the training cohort is unknown.
- `warehouse_density` is `unstable`. Its apparent strength depends too much on one repeated-company cluster and misses the 0.70 stability gate.

Those failures stay visible in the report because a deployment decision needs to explain what was rejected as well as what was selected.

## Explicit veto

`inactive_company` becomes an anti-pattern only because the customer brief says inactive, dissolved, or liquidated companies are not valid buyers.

Historical statistics cannot create or promote that veto. Missing legal status is unknown, not a match.

The committed case has no winning historical deal that matches the veto. A separate end-to-end failure case changes one winning record to inactive and proves that the run names the affected win, exits with evidence code 3, and never starts the MCP preview.

## Evaluation and non-claims

The holdout reports policy coverage, top-bucket lift, false positives, false negatives, and unknowns. Current prospects are ranked with the same frozen policy.

This is **not causal evidence**. The generator contains assumptions and the holdout is synthetic. The result **does not predict real customer revenue** or production Leadbay performance.

In a real engagement I would revisit the questions after 30 days with the customer's sales team, newly closed deals, and the false positives and false negatives they actually saw.
