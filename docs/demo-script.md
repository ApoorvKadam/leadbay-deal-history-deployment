# Three-minute demo script

This walkthrough uses the committed synthetic case. CI separately verifies the same code path with the real `@leadbay/mcp@0.39.10` process in mock mode. The example is not live Leadbay validation and no production account is touched.

1. **Show the source, 0:00 to 0:18.** Open the messy historical CSV and `customer-brief.yaml`. Point out inconsistent websites, missing values, repeated deals, the customer hypotheses, and the inactive-company veto.

2. **State the problem, 0:18 to 0:28.** "Importing rows is easy. The harder part is deciding which observable traits deserve organization-wide qualification questions without overfitting or turning correlation into an exclusion."

3. **Run the workflow, 0:28 to 0:40.** Run `pnpm demo`. It validates the case, analyzes the training history, evaluates the frozen policy, and previews the MCP changes only after the mock safety checks pass.

4. **Show the data decisions, 0:40 to 1:00.** Open `data-quality.md`, `normalized-deals.redacted.csv`, and `split-membership.json`. Call out the duplicate collapse, the company-safe temporal holdout, consumer-mailbox handling, unknown values, and prohibited post-outcome fields.

5. **Show the policy, 1:00 to 1:22.** Open `policy-manifest.json`. Show the three proposed questions for territory field sales, fragmented SMB markets, and CRM or ERP exportability. Then show the one anti-pattern that came from the customer brief. No existing question is removed.

6. **Show what was rejected, 1:22 to 1:48.** Open `signal-evidence.json` and `holdout-evaluation.json`. Compare the selected signals with `enterprise_scale` contradicted, `recent_funding` high-missingness, and `warehouse_density` unstable. Show the held-out result and at least one false-negative example. Do not describe the relationship as causal.

7. **Show current prospects, 1:48 to 2:04.** Open `prospect-preview.csv`. The strong prospect ranks above the weak fits, while the vetoed inactive company is blocked even though it has positive attributes.

8. **Show the MCP trace, 2:04 to 2:24.** Open `leadbay-mcp-trace.json`, `mock-session-attestation.json`, and `docs/verification.md`. Explain the sequence: tool catalog, fixture-backed read, anti-pattern preview, then question preview. CI runs this against the actual pinned Leadbay package.

9. **Show required approvals, 2:24 to 2:42.** Open `leadbay-deployment-preview.json`. Point out the accepted tool inputs, `status: projected`, `persisted: false`, and the invalid base URL. No upstream PR is open and no account change occurred.

10. **Close with the operating plan, 2:42 to 3:00.** Open sections 15 and 16 of `deployment-report.md`. Show the 30-day monitoring plan, the unknowns, the synthetic-data disclosure, and the no-live-apply boundary.
