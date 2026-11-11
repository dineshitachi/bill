import test from "node:test";
import assert from "node:assert/strict";
import { parsePumpCurve, parseVoltageCurve, simulatePumpOperatingPoint } from "../src/pump-hydraulics";

test("solves a rated-voltage operating point from pump and system curves", () => {
  const result = simulatePumpOperatingPoint({
    staticHeadM: 20,
    pipeLengthM: 0,
    pipeInnerDiameterMm: 50,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 230,
    pumpCurve: [{ flowLpm: 0, headM: 50 }, { flowLpm: 100, headM: 0 }],
  });
  assert.ok(Math.abs(result.flowLpm - 60) < 0.001);
  assert.equal(result.totalDynamicHeadM, 20);
  assert.equal(result.voltageAdjusted, false);
});

test("pipe friction lowers the system operating flow", () => {
  const result = simulatePumpOperatingPoint({
    staticHeadM: 20,
    pipeLengthM: 100,
    pipeInnerDiameterMm: 50,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 230,
    pumpCurve: [{ flowLpm: 0, headM: 50 }, { flowLpm: 100, headM: 0 }],
  });
  assert.ok(result.frictionLossM > 0);
  assert.ok(result.flowLpm < 60);
  assert.ok(Math.abs(result.pumpHeadM - result.totalDynamicHeadM) < 0.001);
});

test("larger borewell column diameter reduces friction loss at the operating point", () => {
  const narrowPipe = simulatePumpOperatingPoint({
    staticHeadM: 20,
    pipeLengthM: 150,
    pipeInnerDiameterMm: 40,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 230,
    pumpCurve: [{ flowLpm: 0, headM: 50 }, { flowLpm: 100, headM: 0 }],
  });
  const widePipe = simulatePumpOperatingPoint({
    staticHeadM: 20,
    pipeLengthM: 150,
    pipeInnerDiameterMm: 63,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 230,
    pumpCurve: [{ flowLpm: 0, headM: 50 }, { flowLpm: 100, headM: 0 }],
  });
  assert.ok(narrowPipe.frictionLossM > widePipe.frictionLossM);
  assert.ok(narrowPipe.flowLpm < widePipe.flowLpm);
});

test("scales a per-stage curve and reports head loss allocation by stage", () => {
  const result = simulatePumpOperatingPoint({
    staticHeadM: 20,
    pipeLengthM: 0,
    pipeInnerDiameterMm: 50,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 230,
    stageCount: 2,
    pumpCurve: [{ flowLpm: 0, headM: 30 }, { flowLpm: 100, headM: 0 }],
  });
  assert.ok(Math.abs(result.flowLpm - (100 / 3 * 2)) < 0.001);
  assert.equal(result.stageCount, 2);
  assert.ok(Math.abs(result.perStagePumpHeadM - 10) < 0.001);
  assert.equal(result.perStageStaticHeadM, 10);
  assert.equal(result.perStageFrictionLossM, 0);
});

test("uses voltage correction only when an in-range manufacturer table is provided", () => {
  const result = simulatePumpOperatingPoint({
    staticHeadM: 20,
    pipeLengthM: 0,
    pipeInnerDiameterMm: 50,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 207,
    pumpCurve: [{ flowLpm: 0, headM: 50 }, { flowLpm: 100, headM: 0 }],
    voltageCurve: [
      { voltagePercent: 90, flowFactor: 0.8, headFactor: 0.85 },
      { voltagePercent: 100, flowFactor: 1, headFactor: 1 },
    ],
  });
  assert.equal(result.voltageAdjusted, true);
  assert.ok(Math.abs(result.voltagePercent - 90) < 0.001);
  assert.ok(Math.abs(result.flowLpm - (80 * 22.5 / 42.5)) < 0.001);
});

test("rejects malformed, unordered, and non-intersecting manufacturer curves", () => {
  assert.throws(() => parsePumpCurve("0,50\n0,40"), /ascending/);
  assert.throws(() => parseVoltageCurve("90,0.8,0.9\n100,0,1"), /positive/);
  assert.throws(() => simulatePumpOperatingPoint({
    staticHeadM: 100,
    pipeLengthM: 0,
    pipeInnerDiameterMm: 50,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 230,
    pumpCurve: [{ flowLpm: 0, headM: 50 }, { flowLpm: 100, headM: 0 }],
  }), /does not intersect/);
  assert.throws(() => simulatePumpOperatingPoint({
    staticHeadM: 20,
    pipeLengthM: 0,
    pipeInnerDiameterMm: 50,
    hazenWilliamsC: 150,
    ratedVoltage: 230,
    measuredVoltage: 230,
    stageCount: 1.5,
    pumpCurve: [{ flowLpm: 0, headM: 50 }, { flowLpm: 100, headM: 0 }],
  }), /Stage count/);
});