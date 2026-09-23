# Verification

The repository is checked in GitHub Actions on both Ubuntu and Windows against the real `@leadbay/mcp@0.39.10` package and `@modelcontextprotocol/sdk@1.29.0`.

## What CI checks

A clean run must pass every step below:

1. Install the committed dependency graph with `pnpm install --frozen-lockfile`.
2. Confirm `pnpm-lock.yaml` did not change.
3. Run Biome lint.
4. Run strict TypeScript type checking.
5. Run all 35 test files and 131 tests.
6. Build the CLI on Node.js 22.
7. Regenerate the synthetic case and verify there is no fixture drift.
8. Run `pnpm demo` through the real Leadbay MCP stdio process in mock mode.
9. Confirm the demo left the tracked repository tree unchanged.

The MCP demo runs with:

```text
LEADBAY_MOCK=1
LEADBAY_BASE_URL=https://leadbay.invalid
```

The child process receives an allowlisted environment. Parent cloud credentials, GitHub or npm tokens, proxy settings, `NODE_OPTIONS`, and home/profile configuration are not inherited.

Before the first mock write call, the application also requires the Leadbay mock banner, a fixture-backed read of the starting qualification state, the expected MCP tool contracts, and no production Leadbay hostname anywhere in stderr, tool results, or the saved trace.

## What this proves

The verification proves that the pinned package can be installed from a frozen lockfile, started over stdio, read from the checked-in mock fixtures, and accept the exact mock write inputs produced by this case.

It does not prove production behavior, customer lift, or a live Leadbay account change. The deployment preview remains projected and `persisted: false`.

## Synthetic result

The committed case has 80 normalized historical deals. Sixty are used for training and twenty form a grouped temporal holdout. The frozen policy selects three questions and one customer-authored anti-pattern. The holdout reports 100 percent policy coverage and a synthetic top-bucket lift of 35.0 percentage points.

Those numbers belong to the synthetic case only.
