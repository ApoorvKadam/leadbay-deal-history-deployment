# Example notice

This directory contains a curated deterministic output package for the synthetic Northstar Building Supply case.

The committed MCP trace is produced by the deterministic test double used by the end-to-end test suite. Its tool catalog and write results are intentionally minimal, and its timings and temporary paths are normalized for stable review. It is not a capture of the real Leadbay process.

CI separately runs the compiled CLI against the real `@leadbay/mcp@0.40.0` process in mock mode on Ubuntu and Windows. Use the GitHub Actions run as the integration evidence; use this committed package to review the deterministic policy, call order, inputs, and projected state.

This is not live Leadbay validation. It contains no customer data, Leadbay credentials, or production API access.
