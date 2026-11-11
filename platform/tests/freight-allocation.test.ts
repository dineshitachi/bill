import test from "node:test";
import assert from "node:assert/strict";
import { allocateFreightCents } from "../src/server/freight-allocation";

test("allocates freight to exact cents and assigns remainders deterministically", () => {
  const allocations = allocateFreightCents(1, [1, 1, 1]);
  assert.deepEqual(allocations, [34, 33, 33]);
  assert.equal(allocations.reduce((sum, cents) => sum + cents, 0), 100);
});

test("supports quantity and catalog-value weights with no lost cents", () => {
  assert.deepEqual(allocateFreightCents(12.5, [2, 3]), [500, 750]);
  assert.deepEqual(allocateFreightCents(12.5, [100, 400]), [250, 1000]);
});

test("rejects negative totals, empty lines, and invalid weights", () => {
  assert.throws(() => allocateFreightCents(-1, [1]), /non-negative/);
  assert.throws(() => allocateFreightCents(1, []), /weights/);
  assert.throws(() => allocateFreightCents(1, [1, 0]), /positive/);
});