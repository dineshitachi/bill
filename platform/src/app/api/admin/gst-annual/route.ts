import ExcelJS from "exceljs";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";
import { decryptField } from "@/server/field-encryption";

export async function GET(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) return jsonError("Select a valid filing year");
  const invoices = await auth.db.invoice.findMany({
    where: { status: "INVOICE", issuedAt: { gte: new Date(`${year}-01-01T00:00:00Z`), lt: new Date(`${year + 1}-01-01T00:00:00Z`) } },
    include: { items: true },
    orderBy: { issuedAt: "asc" },
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Namma Bill POS";
  workbook.created = new Date();
  const invoiceSheet = workbook.addWorksheet("Invoices");
  invoiceSheet.columns = [
    { header: "Invoice", key: "number", width: 24 },
    { header: "Date", key: "date", width: 14 },
    { header: "Customer", key: "customer", width: 28 },
    { header: "Customer GSTIN", key: "gstin", width: 20 },
    { header: "Place of supply", key: "state", width: 16 },
    { header: "Taxable value", key: "taxable", width: 18 },
    { header: "CGST", key: "cgst", width: 14 },
    { header: "SGST", key: "sgst", width: 14 },
    { header: "IGST", key: "igst", width: 14 },
    { header: "Invoice total", key: "total", width: 18 },
    { header: "Amount paid", key: "paid", width: 18 },
    { header: "Payment status", key: "status", width: 18 },
  ];
  invoiceSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  invoiceSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5543D1" } };
  for (const invoice of invoices) {
    invoiceSheet.addRow({
      number: invoice.number,
      date: invoice.issuedAt.toISOString().slice(0, 10),
      customer: decryptField(invoice.customerName),
      gstin: decryptField(invoice.customerGstin),
      state: invoice.placeOfSupplyStateCode,
      taxable: invoice.items.reduce((sum, item) => sum + Number(item.taxableValue), 0),
      cgst: invoice.items.reduce((sum, item) => sum + Number(item.cgst), 0),
      sgst: invoice.items.reduce((sum, item) => sum + Number(item.sgst), 0),
      igst: invoice.items.reduce((sum, item) => sum + Number(item.igst), 0),
      total: Number(invoice.grandTotal),
      paid: Number(invoice.amountPaid),
      status: invoice.paymentStatus,
    });
  }
  for (const key of ["taxable", "cgst", "sgst", "igst", "total", "paid"]) {
    const column = invoiceSheet.getColumn(key);
    column.numFmt = "₹#,##0.00";
  }
  const taxSheet = workbook.addWorksheet("HSN Tax Summary");
  taxSheet.columns = [
    { header: "HSN/SAC", key: "hsn", width: 18 },
    { header: "GST rate (%)", key: "rate", width: 16 },
    { header: "Taxable value", key: "taxable", width: 18 },
    { header: "CGST", key: "cgst", width: 14 },
    { header: "SGST", key: "sgst", width: 14 },
    { header: "IGST", key: "igst", width: 14 },
  ];
  taxSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  taxSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24644D" } };
  const hsnTotals = new Map<string, { rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const invoice of invoices) for (const item of invoice.items) {
    const key = `${item.hsnCode || "—"}|${Number(item.gstRate)}`;
    const row = hsnTotals.get(key) || { rate: Number(item.gstRate), taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += Number(item.taxableValue);
    row.cgst += Number(item.cgst);
    row.sgst += Number(item.sgst);
    row.igst += Number(item.igst);
    hsnTotals.set(key, row);
  }
  for (const [key, values] of hsnTotals) {
    taxSheet.addRow({ hsn: key.split("|")[0], ...values });
  }
  for (const key of ["taxable", "cgst", "sgst", "igst"]) taxSheet.getColumn(key).numFmt = "₹#,##0.00";
  const file = new Uint8Array(await workbook.xlsx.writeBuffer());
  return new Response(file, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="gst-summary-${year}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
