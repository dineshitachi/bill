export type DocumentKind = "invoice" | "quotation" | "receipt";
export type DocumentLine = { name: string; sku?: string; quantity: number; unitPrice: number; taxRate?: number; taxableValue?: number; taxTotal?: number; total: number };
export type DocumentModel = {
  kind: DocumentKind; number: string; issuedAt: string; currency: string; locale?: string;
  seller: { name: string; legalName?: string; taxId?: string; address?: string };
  customer: { name: string; taxId?: string; address?: string };
  lines: DocumentLine[]; subtotal: number; discount?: number; taxTotal: number; total: number; amountPaid?: number; balanceDue?: number; terms?: string;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

const css = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2937; font: 14px/1.45 Arial, sans-serif; }
  .document { max-width: 190mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 18px; }
  .muted { color: #6b7280; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 18px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th:last-child, td:last-child { text-align: right; }
  tr { break-inside: avoid; }
  .totals { width: 280px; margin: 18px 0 0 auto; }
  .totals p { display: flex; justify-content: space-between; margin: 6px 0; }
  .grand { border-top: 2px solid #111827; padding-top: 8px; font-size: 18px; font-weight: 700; }
  .receipt { max-width: 80mm; font-size: 12px; }
  .receipt .header { display: block; text-align: center; }
  .quotation .header { border-color: #2563eb; }
  .quotation .grand { color: #2563eb; }
  .footer { margin-top: 28px; color: #6b7280; font-size: 11px; page-break-inside: avoid; }
`;

function lineRows(model: DocumentModel): string {
  return model.lines.map((line) => `<tr><td><strong>${escapeHtml(line.name)}</strong>${line.sku ? `<div class="muted">${escapeHtml(line.sku)}</div>` : ""}</td><td>${line.quantity}</td><td>${money(line.unitPrice, model.currency, model.locale || "en-IN")}</td><td>${line.taxRate ?? 0}%</td><td>${money(line.total, model.currency, model.locale || "en-IN")}</td></tr>`).join("");
}

export function renderDocumentTemplate(model: DocumentModel): { html: string; css: string } {
  const locale = model.locale || "en-IN";
  const title = model.kind === "invoice" ? "Tax Invoice" : model.kind === "quotation" ? "Quotation / Estimate" : "Payment Receipt";
  const paid = model.amountPaid ?? 0;
  const balance = model.balanceDue ?? Math.max(0, model.total - paid);
  const className = model.kind;
  const taxLabel = model.kind === "quotation" ? "Estimated tax" : "Tax";
  const html = `<article class="document ${className}">
    <header class="header"><div><h1>${escapeHtml(title)}</h1><strong>${escapeHtml(model.seller.name)}</strong><div class="muted">${escapeHtml(model.seller.legalName || "")}</div><div class="muted">${escapeHtml(model.seller.address || "")}</div></div><div><strong>${escapeHtml(model.number)}</strong><div class="muted">${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(model.issuedAt))}</div><div class="muted">Currency: ${escapeHtml(model.currency)}</div></div></header>
    <section class="meta"><div><strong>Bill to</strong><div>${escapeHtml(model.customer.name)}</div><div class="muted">${escapeHtml(model.customer.taxId || "")}</div><div class="muted">${escapeHtml(model.customer.address || "")}</div></div><div><strong>Seller tax ID</strong><div>${escapeHtml(model.seller.taxId || "")}</div></div></section>
    <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Tax</th><th>Total</th></tr></thead><tbody>${lineRows(model)}</tbody></table>
    <section class="totals"><p><span>Subtotal</span><span>${money(model.subtotal, model.currency, locale)}</span></p>${model.discount ? `<p><span>Discount</span><span>-${money(model.discount, model.currency, locale)}</span></p>` : ""}<p><span>${taxLabel}</span><span>${money(model.taxTotal, model.currency, locale)}</span></p><p class="grand"><span>Total</span><span>${money(model.total, model.currency, locale)}</span></p>${model.kind === "receipt" ? `<p><span>Received</span><span>${money(paid, model.currency, locale)}</span></p><p><span>Balance</span><span>${money(balance, model.currency, locale)}</span></p>` : ""}</section>
    <footer class="footer">${escapeHtml(model.terms || "Thank you for your business.")}</footer>
  </article>`;
  return { html, css };
}
