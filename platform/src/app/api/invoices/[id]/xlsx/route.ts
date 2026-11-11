import ExcelJS from "exceljs";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";
import { decryptInvoiceWithPayments } from "@/server/field-encryption";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const invoice = await auth.db.invoice.findUnique({
    where: { id },
    include: { items: true, payments: { orderBy: { receivedAt: "asc" } } },
  });
  if (!invoice) return jsonError("Invoice not found", 404);
  const safeInvoice = decryptInvoiceWithPayments(invoice);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Namma Bill POS";
  const sheet = workbook.addWorksheet("Invoice");
  sheet.columns = [
    { header: "Item", key: "name", width: 30 },
    { header: "HSN/SAC", key: "hsn", width: 15 },
    { header: "Quantity", key: "quantity", width: 13 },
    { header: "Unit price", key: "unitPrice", width: 16 },
    { header: "Taxable value", key: "taxable", width: 17 },
    { header: "GST rate (%)", key: "rate", width: 14 },
    { header: "CGST", key: "cgst", width: 14 },
    { header: "SGST", key: "sgst", width: 14 },
    { header: "IGST", key: "igst", width: 14 },
    { header: "Line total", key: "total", width: 16 },
  ];
  sheet.addRow({ name: safeInvoice.sellerLegalName || "Tax invoice", hsn: safeInvoice.number });
  sheet.addRow({ name: "Brand", hsn: safeInvoice.sellerBrandName });
  sheet.addRow({ name: "Supplier GSTIN", hsn: safeInvoice.sellerGstin });
  sheet.addRow({ name: "Customer", hsn: safeInvoice.customerName });
  sheet.addRow({ name: "Customer GSTIN", hsn: safeInvoice.customerGstin });
  sheet.addRow({ name: "Invoice date", hsn: safeInvoice.issuedAt.toISOString() });
  sheet.addRow({ name: "Place of supply", hsn: safeInvoice.placeOfSupplyStateCode });
  sheet.addRow([]);
  sheet.addRow(sheet.columns.map((column) => column.header));
  const headerRow = sheet.lastRow;
  if (headerRow) {
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5543D1" } };
  }
  for (const item of safeInvoice.items) {
    sheet.addRow({
      name: item.name, hsn: item.hsnCode, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice),
      taxable: Number(item.taxableValue), rate: Number(item.gstRate), cgst: Number(item.cgst),
      sgst: Number(item.sgst), igst: Number(item.igst), total: Number(item.total),
    });
  }
  const totals = sheet.addRow({ name: "Subtotal", total: Number(safeInvoice.subtotal) });
  sheet.addRow({ name: "Discount", total: -Number(safeInvoice.discount) });
  sheet.addRow({ name: "Tax total", total: Number(safeInvoice.taxTotal) });
  sheet.addRow({ name: "Round off", total: Number(safeInvoice.roundOff) });
  sheet.addRow({ name: "Invoice total", total: Number(safeInvoice.grandTotal) });
  sheet.addRow({ name: "Amount paid", total: Number(safeInvoice.amountPaid) });
  sheet.addRow({ name: "Payment status", total: safeInvoice.paymentStatus });
  totals.font = { bold: true };
  for (const key of ["unitPrice", "taxable", "cgst", "sgst", "igst", "total"]) sheet.getColumn(key).numFmt = "₹#,##0.00";

  const paymentSheet = workbook.addWorksheet("Payment history");
  paymentSheet.columns = [
    { header: "Received at", key: "receivedAt", width: 24 },
    { header: "Amount", key: "amount", width: 18 },
    { header: "Method", key: "method", width: 22 },
    { header: "Recorded by", key: "receivedBy", width: 24 },
    { header: "Record type", key: "recordType", width: 28 },
  ];
  paymentSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  paymentSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5543D1" } };
  for (const payment of safeInvoice.payments) {
    paymentSheet.addRow({
      receivedAt: payment.receivedAt.toISOString(),
      amount: Number(payment.amount),
      method: payment.isLegacySnapshot ? "Opening balance snapshot" : payment.paymentMethod,
      receivedBy: payment.receivedBy,
      recordType: payment.isLegacySnapshot ? "Imported opening balance" : "Payment transaction",
    });
  }
  paymentSheet.getColumn("amount").numFmt = "₹#,##0.00";

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${invoice.number}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
