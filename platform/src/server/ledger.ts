type NumericValue = string | number | { toString(): string };
type LedgerItem = {
  name: string;
  quantity: NumericValue;
  unitPrice: NumericValue;
  gstRate: NumericValue;
  cgst: NumericValue;
  sgst: NumericValue;
  igst: NumericValue;
  total: NumericValue;
};
type LedgerInvoice = {
  number: string;
  issuedAt: Date;
  customerName: string;
  customerGstin: string;
  taxTotal: NumericValue;
  grandTotal: NumericValue;
  items: LedgerItem[];
};

function exactDecimal(value: NumericValue, scale: number): string {
  const [whole, fraction = ""] = String(value).split(".");
  return `${whole}.${fraction.padEnd(scale, "0").slice(0, scale)}`;
}

function csvCell(value: string): string {
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function invoiceLedgerCsv(invoices: LedgerInvoice[]): string {
  const rows = invoices.map((invoice) => {
    const customer = invoice.customerGstin
      ? `${invoice.customerName} (GSTIN: ${invoice.customerGstin})`
      : invoice.customerName;
    const breakdown = invoice.items.map((item) =>
      `${item.name}: ${exactDecimal(item.quantity, 3)} x ${exactDecimal(item.unitPrice, 2)} @ ${exactDecimal(item.gstRate, 2)}% GST; CGST ${exactDecimal(item.cgst, 2)}, SGST ${exactDecimal(item.sgst, 2)}, IGST ${exactDecimal(item.igst, 2)}; total ${exactDecimal(item.total, 2)}`,
    ).join(" | ");
    return [
      invoice.number,
      invoice.issuedAt.toISOString().slice(0, 10),
      customer,
      breakdown,
      exactDecimal(invoice.taxTotal, 2),
      exactDecimal(invoice.grandTotal, 2),
    ];
  });
  return [
    ["Invoice Number", "Date", "Customer Details", "Itemized Breakdown", "Tax", "Grand Total"],
    ...rows,
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
}