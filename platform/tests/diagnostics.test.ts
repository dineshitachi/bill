import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDiagnosticText } from "../src/diagnostics";

test("redacts common credentials and personal identifiers from diagnostic text", () => {
  const safe = sanitizeDiagnosticText("Bearer abc.def; password=hunter2 user@example.com +919876543210 Aadhaar 123456789012");
  assert.equal(safe.includes("abc.def"), false);
  assert.equal(safe.includes("hunter2"), false);
  assert.equal(safe.includes("user@example.com"), false);
  assert.equal(safe.includes("9876543210"), false);
  assert.equal(safe.includes("123456789012"), false);
  assert.match(safe, /\[redacted\]/);
});

test("normalizes control characters and bounds diagnostic message length", () => {
  const safe = sanitizeDiagnosticText(`first\nsecond\t${"x".repeat(600)}`);
  assert.equal(safe.includes("\n"), false);
  assert.equal(safe.includes("\t"), false);
  assert.equal(safe.length, 500);
});