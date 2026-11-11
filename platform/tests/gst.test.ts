import test from "node:test";
import assert from "node:assert/strict";
import { allocateDiscountCents, calculateTax, isGstinFormatValid } from "../src/gst";

test("splits intra-state GST evenly into CGST and SGST", () => {
  assert.deepEqual(calculateTax(2, 100, 18, "33", "33"), {
    taxableValue: 200,
    cgst: 18,
    sgst: 18,
    igst: 0,
    total: 236,
  });
});

test("uses IGST when place of supply differs from supplier state", () => {
  assert.deepEqual(calculateTax(1, 125, 12, "33", "29"), {
    taxableValue: 125,
    cgst: 0,
    sgst: 0,
    igst: 15,
    total: 140,
  });
});

test("rejects invalid quantities, rates, and GSTIN formats", () => {
  assert.throws(() => calculateTax(0, 100, 18, "33", "33"));
  assert.throws(() => calculateTax(1, 100, 101, "33", "33"));
  assert.equal(isGstinFormatValid("33ABCDE1234F1Z5"), true);
  assert.equal(isGstinFormatValid("not-a-gstin"), false);
});

test("allocates discount cents exactly across invoice lines", () => {
  assert.deepEqual(allocateDiscountCents(1, [10, 10, 10]), [33, 33, 34]);
});