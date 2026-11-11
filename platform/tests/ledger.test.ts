import test from "node:test";
import assert from "node:assert/strict";
import { invoiceLedgerCsv } from "../src/server/ledger";

test("formats a ledger row with exact decimal strings and formula-safe text", () => {
  const csv = invoiceLedgerCsv([{
    number: "INV-2026-0001",
    issuedAt: new Date("2026-11-06T10:00:00.000Z"),
    customerName: "=HYPERLINK(\"bad\")",
    customerGstin: "33ABCDE1234F1Z5",
    taxTotal: "0.48",
    grandTotal: "2.96",
    items: [{
      name: "Wire, copper",
      quantity: "1.200",
      unitPrice: "2.50",
      gstRate: "18.00",
      cgst: "0.24",
      sgst: "0.24",
      igst: "0.00",
      total: "2.96",
    }],
  }]);

  assert.match(csv, /^"Invoice Number","Date","Customer Details","Itemized Breakdown","Tax","Grand Total"/);
  assert.match(csv, /"'\=HYPERLINK\(""bad""\) \(GSTIN: 33ABCDE1234F1Z5\)"/);
  assert.match(csv, /"Wire, copper: 1\.200 x 2\.50 @ 18\.00% GST; CGST 0\.24, SGST 0\.24, IGST 0\.00; total 2\.96"/);
  assert.match(csv, /"0\.48","2\.96"/);
});