import { describe, expect, it } from "vitest";
import { sha256Stable, stableStringify } from "../../../src/shared/stable-json.js";

describe("stableStringify", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const value = { z: 1, nested: { b: 2, a: 1 }, rows: [{ y: 2, x: 1 }] };
    expect(stableStringify(value)).toBe(
      '{\n  "nested": {\n    "a": 1,\n    "b": 2\n  },\n  "rows": [\n    {\n      "x": 1,\n      "y": 2\n    }\n  ],\n  "z": 1\n}\n',
    );
  });

  it("hashes semantically identical objects identically", () => {
    expect(sha256Stable({ b: 2, a: 1 })).toBe(sha256Stable({ a: 1, b: 2 }));
  });
});
