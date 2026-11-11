export type PumpCurvePoint = { flowLpm: number; headM: number };
export type VoltageCorrectionPoint = { voltagePercent: number; flowFactor: number; headFactor: number };

export type PumpSimulationInput = {
  staticHeadM: number;
  pipeLengthM: number;
  pipeInnerDiameterMm: number;
  hazenWilliamsC: number;
  ratedVoltage: number;
  measuredVoltage: number;
  stageCount?: number;
  pumpCurve: PumpCurvePoint[];
  voltageCurve?: VoltageCorrectionPoint[];
};

export type PumpSimulationResult = {
  flowLpm: number;
  pumpHeadM: number;
  frictionLossM: number;
  totalDynamicHeadM: number;
  voltagePercent: number;
  voltageAdjusted: boolean;
  stageCount: number;
  perStagePumpHeadM: number;
  perStageStaticHeadM: number;
  perStageFrictionLossM: number;
};

function validateIncreasing(values: number[], label: string): void {
  if (values.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= values[index - 1]))) {
    throw new Error(`${label} values must be finite, unique, and in ascending order`);
  }
}

export function parsePumpCurve(text: string): PumpCurvePoint[] {
  const points = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const values = line.split(/[\s,;]+/).map(Number);
    if (values.length !== 2 || values.some((value) => !Number.isFinite(value))) throw new Error("Pump curve rows must contain flow L/min and head m");
    return { flowLpm: values[0], headM: values[1] };
  });
  if (points.length < 2) throw new Error("Enter at least two pump curve points");
  validateIncreasing(points.map((point) => point.flowLpm), "Pump flow");
  if (points.some((point) => point.flowLpm < 0 || point.headM < 0)) throw new Error("Pump flow and head cannot be negative");
  if (points.some((point, index) => index > 0 && point.headM > points[index - 1].headM)) throw new Error("Pump head must stay flat or decrease as flow increases");
  return points;
}

export function parseVoltageCurve(text: string): VoltageCorrectionPoint[] {
  const points = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const values = line.split(/[\s,;]+/).map(Number);
    if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) throw new Error("Voltage rows must contain voltage %, flow factor, and head factor");
    return { voltagePercent: values[0], flowFactor: values[1], headFactor: values[2] };
  });
  if (points.length < 2) throw new Error("Enter at least two voltage correction points");
  validateIncreasing(points.map((point) => point.voltagePercent), "Voltage percentage");
  if (points.some((point) => point.voltagePercent <= 0 || point.flowFactor <= 0 || point.headFactor <= 0)) {
    throw new Error("Voltage percentages and correction factors must be positive");
  }
  return points;
}

function interpolate(points: Array<{ x: number; y: number }>, x: number): number {
  if (x < points[0].x || x > points.at(-1)!.x) throw new Error("Input is outside the supplied manufacturer curve range");
  for (let index = 1; index < points.length; index += 1) {
    if (x <= points[index].x) {
      const left = points[index - 1];
      const right = points[index];
      const ratio = (x - left.x) / (right.x - left.x);
      return left.y + ratio * (right.y - left.y);
    }
  }
  return points.at(-1)!.y;
}

function frictionLossM(flowLpm: number, lengthM: number, diameterMm: number, hazenWilliamsC: number): number {
  if (flowLpm === 0 || lengthM === 0) return 0;
  const flowM3PerSecond = flowLpm / 60_000;
  const diameterM = diameterMm / 1000;
  return 10.67 * lengthM * flowM3PerSecond ** 1.852 / (hazenWilliamsC ** 1.852 * diameterM ** 4.8704);
}

export function simulatePumpOperatingPoint(input: PumpSimulationInput): PumpSimulationResult {
  const { staticHeadM, pipeLengthM, pipeInnerDiameterMm, hazenWilliamsC, ratedVoltage, measuredVoltage } = input;
  const stageCount = input.stageCount ?? 1;
  if (![staticHeadM, pipeLengthM, pipeInnerDiameterMm, hazenWilliamsC, ratedVoltage, measuredVoltage].every(Number.isFinite)) throw new Error("All hydraulic and voltage inputs must be finite numbers");
  if (staticHeadM < 0 || pipeLengthM < 0 || pipeInnerDiameterMm <= 0 || hazenWilliamsC <= 0 || ratedVoltage <= 0 || measuredVoltage <= 0) throw new Error("Head and pipe length must be non-negative; diameter, C value, and voltages must be positive");
  if (!Number.isInteger(stageCount) || stageCount < 1 || stageCount > 100) throw new Error("Stage count must be an integer from 1 to 100");
  if (input.pumpCurve.length < 2) throw new Error("At least two pump curve points are required");
  validateIncreasing(input.pumpCurve.map((point) => point.flowLpm), "Pump flow");
  if (input.pumpCurve.some((point) => point.flowLpm < 0 || point.headM < 0 || !Number.isFinite(point.headM))) throw new Error("Pump curve values must be finite and non-negative");
  if (input.pumpCurve.some((point, index) => index > 0 && point.headM > input.pumpCurve[index - 1].headM)) throw new Error("Pump head must stay flat or decrease as flow increases");

  const voltagePercent = measuredVoltage / ratedVoltage * 100;
  const voltageCurve = input.voltageCurve || [];
  let flowFactor = 1;
  let headFactor = 1;
  if (voltageCurve.length === 1) throw new Error("Voltage correction table requires at least two points");
  const voltageAdjusted = voltageCurve.length >= 2;
  if (voltageAdjusted) {
    validateIncreasing(voltageCurve.map((point) => point.voltagePercent), "Voltage percentage");
    if (voltageCurve.some((point) => point.voltagePercent <= 0 || point.flowFactor <= 0 || point.headFactor <= 0 || !Number.isFinite(point.flowFactor) || !Number.isFinite(point.headFactor))) {
      throw new Error("Voltage correction values must be finite and positive");
    }
    flowFactor = interpolate(voltageCurve.map((point) => ({ x: point.voltagePercent, y: point.flowFactor })), voltagePercent);
    headFactor = interpolate(voltageCurve.map((point) => ({ x: point.voltagePercent, y: point.headFactor })), voltagePercent);
  }

  const curve = input.pumpCurve.map((point) => ({ flowLpm: point.flowLpm * flowFactor, headM: point.headM * headFactor * stageCount }));
  const difference = (flowLpm: number) => {
    const pumpHead = interpolate(curve.map((point) => ({ x: point.flowLpm, y: point.headM })), flowLpm);
    return pumpHead - (staticHeadM + frictionLossM(flowLpm, pipeLengthM, pipeInnerDiameterMm, hazenWilliamsC));
  };
  let low = curve[0].flowLpm;
  let high = curve.at(-1)!.flowLpm;
  let lowDifference = difference(low);
  if (lowDifference < 0 || difference(high) > 0) throw new Error("The supplied pump curve does not intersect the entered system curve");
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (difference(middle) > 0) low = middle;
    else high = middle;
  }
  const flowLpm = (low + high) / 2;
  const pumpHeadM = interpolate(curve.map((point) => ({ x: point.flowLpm, y: point.headM })), flowLpm);
  const friction = frictionLossM(flowLpm, pipeLengthM, pipeInnerDiameterMm, hazenWilliamsC);
  return {
    flowLpm,
    pumpHeadM,
    frictionLossM: friction,
    totalDynamicHeadM: staticHeadM + friction,
    voltagePercent,
    voltageAdjusted,
    stageCount,
    perStagePumpHeadM: pumpHeadM / stageCount,
    perStageStaticHeadM: staticHeadM / stageCount,
    perStageFrictionLossM: friction / stageCount,
  };
}