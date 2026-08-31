import { describe, expect, it } from "vitest";
import { computeRetailPrice } from "../src/pricing.js";

describe("computeRetailPrice", () => {
  it("applies the markup multiplier and rounds to cents", () => {
    expect(computeRetailPrice(10, 2.5)).toBe(25);
    expect(computeRetailPrice(9.99, 2.2)).toBe(21.98);
  });

  it("rejects a negative cost price", () => {
    expect(() => computeRetailPrice(-1, 2)).toThrow();
  });

  it("rejects a non-positive markup", () => {
    expect(() => computeRetailPrice(10, 0)).toThrow();
    expect(() => computeRetailPrice(10, -1)).toThrow();
  });
});
