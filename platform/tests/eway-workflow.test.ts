import test from "node:test";
import assert from "node:assert/strict";
import { canPrepareLocalEWayPayload, canStartEWayOperation, ewayProviderSuccessStatus } from "../src/server/eway-workflow";

test("only local, failed, or cancelled records can prepare a payload or start a new create", () => {
  for (const status of [undefined, "READY", "FAILED", "CANCELLED"]) {
    assert.equal(canPrepareLocalEWayPayload(status), true);
    assert.equal(canStartEWayOperation("CREATE", status, ""), true);
  }
  for (const status of ["SUBMITTING", "SUBMITTED", "UPDATING", "CANCELLING", "UNKNOWN", "PROVIDER_ACCEPTED"]) {
    assert.equal(canPrepareLocalEWayPayload(status), false);
    assert.equal(canStartEWayOperation("CREATE", status, ""), false);
  }
});

test("only provider-confirmed bills can be updated or cancelled", () => {
  assert.equal(canStartEWayOperation("UPDATE", "SUBMITTED", "EWB-123"), true);
  assert.equal(canStartEWayOperation("CANCEL", "SUBMITTED", "EWB-123"), true);
  assert.equal(canStartEWayOperation("UPDATE", "SUBMITTED", ""), false);
  assert.equal(canStartEWayOperation("CANCEL", "READY", "EWB-123"), false);
  assert.equal(canStartEWayOperation("UPDATE", "UNKNOWN", "EWB-123"), false);
});

test("provider success is not reported as registered without an E-Way number", () => {
  assert.equal(ewayProviderSuccessStatus("CREATE", ""), "PROVIDER_ACCEPTED");
  assert.equal(ewayProviderSuccessStatus("CREATE", "EWB-123"), "SUBMITTED");
  assert.equal(ewayProviderSuccessStatus("UPDATE", "EWB-123"), "SUBMITTED");
  assert.equal(ewayProviderSuccessStatus("CANCEL", "EWB-123"), "CANCELLED");
});