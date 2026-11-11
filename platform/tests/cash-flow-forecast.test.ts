import test from "node:test";
import assert from "node:assert/strict";
import { buildCashFlowForecast } from "../src/server/cash-flow-forecast";

const now = new Date("2026-11-07T00:00:00.000Z");

test("uses weighted payment history to time open receivables and estimates the funding gap", () => {
  const forecast = buildCashFlowForecast({
    now,
    days: 30,
    openingBalance: 100,
    receivables: [{ issuedAt: "2026-10-01T00:00:00.000Z", balance: "1000" }],
    payments: [
      { issuedAt: "2026-10-01T00:00:00.000Z", receivedAt: "2026-10-11T00:00:00.000Z", amount: "100" },
      { issuedAt: "2026-10-01T00:00:00.000Z", receivedAt: "2026-10-21T00:00:00.000Z", amount: "300" },
    ],
    historicalExpenses: 600,
  });

  assert.equal(forecast.collectionDelayDays, 17.5);
  assert.equal(forecast.collectionDelaySource, "historical");
  assert.equal(forecast.expectedReceipts, 1000);
  assert.equal(forecast.buckets.length, 5);
  assert.ok(forecast.fundingGap > 0);
});

test("uses a documented fallback when no payment history exists", () => {
  const forecast = buildCashFlowForecast({
    now,
    days: 30,
    openingBalance: 0,
    receivables: [{ issuedAt: now, balance: 500 }],
    payments: [],
    historicalExpenses: 0,
  });

  assert.equal(forecast.collectionDelayDays, 30);
  assert.equal(forecast.collectionDelaySource, "default");
  assert.equal(forecast.expectedReceipts, 0);
  assert.equal(forecast.fundingGap, 0);
});

test("does not project negative expenses or collect invalid receivables", () => {
  const forecast = buildCashFlowForecast({
    now,
    days: 30,
    openingBalance: 250,
    receivables: [{ issuedAt: now, balance: "not-a-number" }, { issuedAt: now, balance: -20 }],
    payments: [],
    historicalExpenses: -100,
  });

  assert.equal(forecast.outstandingReceivables, 0);
  assert.equal(forecast.expectedReceipts, 0);
  assert.equal(forecast.projectedExpenses, 0);
  assert.equal(forecast.fundingGap, 0);
});