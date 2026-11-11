const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 365.25 / 12;
const EXPENSE_HISTORY_DAYS = 180;

export type ForecastReceivable = { issuedAt: Date | string; balance: number | string };
export type ForecastPayment = { issuedAt: Date | string; receivedAt: Date | string; amount: number | string };
export type ForecastBucket = {
  start: string;
  end: string;
  expectedReceipts: number;
  projectedExpenses: number;
  netChange: number;
  endingBalance: number;
};

export function buildCashFlowForecast(input: {
  now: Date;
  days: number;
  openingBalance: number;
  receivables: ForecastReceivable[];
  payments: ForecastPayment[];
  historicalExpenses: number;
}): {
  days: number;
  openingBalance: number;
  collectionDelayDays: number;
  collectionDelaySource: "historical" | "default";
  historicalPaymentCount: number;
  historicalMonthlyExpenses: number;
  outstandingReceivables: number;
  expectedReceipts: number;
  projectedExpenses: number;
  endingBalance: number;
  fundingGap: number;
  buckets: ForecastBucket[];
} {
  const paymentWeights = input.payments.reduce((result, payment) => {
    const amount = Number(payment.amount);
    const delay = (new Date(payment.receivedAt).getTime() - new Date(payment.issuedAt).getTime()) / DAY_MS;
    if (Number.isFinite(amount) && amount > 0 && Number.isFinite(delay) && delay >= 0) {
      result.weightedDays += Math.min(delay, 365) * amount;
      result.amount += amount;
      result.count += 1;
    }
    return result;
  }, { weightedDays: 0, amount: 0, count: 0 });
  const hasPaymentHistory = paymentWeights.amount > 0;
  const collectionDelayDays = hasPaymentHistory ? paymentWeights.weightedDays / paymentWeights.amount : 30;
  const expenseDailyAverage = Math.max(0, Number(input.historicalExpenses) || 0) / EXPENSE_HISTORY_DAYS;
  const historicalMonthlyExpenses = expenseDailyAverage * DAYS_PER_MONTH;
  const horizonEnd = input.now.getTime() + input.days * DAY_MS;
  const bucketCount = Math.ceil(input.days / 7);
  let runningBalance = input.openingBalance;
  let expectedReceipts = 0;
  let projectedExpenses = 0;
  let minimumBalance = runningBalance;

  const buckets = Array.from({ length: bucketCount }, (_, index): ForecastBucket => {
    const startTime = input.now.getTime() + index * 7 * DAY_MS;
    const endTime = Math.min(startTime + 7 * DAY_MS, horizonEnd);
    const receipts = input.receivables.reduce((total, receivable) => {
      const balance = Number(receivable.balance);
      if (!Number.isFinite(balance) || balance <= 0) return total;
      const estimatedCollection = Math.max(input.now.getTime(), new Date(receivable.issuedAt).getTime() + collectionDelayDays * DAY_MS);
      return estimatedCollection >= startTime && estimatedCollection < endTime ? total + balance : total;
    }, 0);
    const expenses = expenseDailyAverage * ((endTime - startTime) / DAY_MS);
    const netChange = receipts - expenses;
    runningBalance += netChange;
    expectedReceipts += receipts;
    projectedExpenses += expenses;
    minimumBalance = Math.min(minimumBalance, runningBalance);
    return {
      start: new Date(startTime).toISOString(),
      end: new Date(endTime).toISOString(),
      expectedReceipts: receipts,
      projectedExpenses: expenses,
      netChange,
      endingBalance: runningBalance,
    };
  });

  return {
    days: input.days,
    openingBalance: input.openingBalance,
    collectionDelayDays,
    collectionDelaySource: hasPaymentHistory ? "historical" : "default",
    historicalPaymentCount: paymentWeights.count,
    historicalMonthlyExpenses,
    outstandingReceivables: input.receivables.reduce((total, item) => total + Math.max(0, Number(item.balance) || 0), 0),
    expectedReceipts,
    projectedExpenses,
    endingBalance: runningBalance,
    fundingGap: Math.max(0, -minimumBalance),
    buckets,
  };
}