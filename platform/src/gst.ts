export type TaxBreakup = { taxableValue: number; cgst: number; sgst: number; igst: number; total: number };

export function calculateTax(
  quantity: number,
  unitPrice: number,
  gstRate: number,
  supplierStateCode: string,
  placeOfSupplyStateCode: string,
): TaxBreakup {
  if (![quantity, unitPrice, gstRate].every(Number.isFinite) || quantity <= 0 || unitPrice < 0 || gstRate < 0 || gstRate > 100) {
    throw new Error("Invalid quantity, price, or GST rate");
  }
  const money = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
  const taxableValue = money(quantity * unitPrice);
  const totalTax = money((taxableValue * gstRate) / 100);
  const intraState = supplierStateCode === placeOfSupplyStateCode;
  const cgst = intraState ? money(totalTax / 2) : 0;
  const sgst = intraState ? money(totalTax - cgst) : 0;
  const igst = intraState ? 0 : totalTax;
  return { taxableValue, cgst, sgst, igst, total: money(taxableValue + totalTax) };
}

export function isGstinFormatValid(gstin: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin.toUpperCase());
}

export function allocateDiscountCents(discount: number, lineValues: number[]): number[] {
  const cents = Math.round(discount * 100);
  const subtotal = lineValues.reduce((sum, value) => sum + value, 0);
  let remaining = cents;
  return lineValues.map((value, index) => {
    const allocation = index === lineValues.length - 1
      ? remaining
      : subtotal === 0 ? 0 : Math.min(remaining, Math.round(cents * value / subtotal));
    remaining -= allocation;
    return allocation;
  });
}