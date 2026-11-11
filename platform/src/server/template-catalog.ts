export type GalleryDocumentKind = "GST_INVOICE" | "RETAIL_BILL" | "THERMAL_RECEIPT" | "QUOTATION" | "PURCHASE_ORDER";
export type GalleryTemplate = {
  code: string; name: string; documentKind: GalleryDocumentKind; version: number; source: "BUILT_IN" | "CLOUD" | "CUSTOM";
  schema: { accent: string; background: string; logoPlacement: "left" | "center" | "right"; columns: string[]; signature: boolean; signatureData?: string; paper: "A4" | "58mm" | "80mm" };
};

const names = ["Aurora", "Ledger", "Minimal", "Slate", "Mint", "Indigo", "Studio", "Classic", "Grid", "Modern", "Mono", "Copper", "Horizon", "Retail", "Pro", "Bold", "Compact", "Elegant", "Prime", "Signature"] as const;
const colors = ["#5543d1", "#0f766e", "#1f2937", "#0369a1", "#b45309", "#be123c", "#4338ca", "#166534"] as const;

export function builtInTemplates(): GalleryTemplate[] {
  const kinds: GalleryDocumentKind[] = ["GST_INVOICE", "RETAIL_BILL", "THERMAL_RECEIPT", "QUOTATION", "PURCHASE_ORDER"];
  return kinds.flatMap((documentKind, kindIndex) => names.map((name, index) => ({
    code: `${documentKind.toLowerCase()}-${String(index + 1).padStart(2, "0")}`,
    name: `${name} ${documentKind.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
    documentKind, version: 1, source: "BUILT_IN" as const,
    schema: {
      accent: colors[(index + kindIndex) % colors.length], background: index % 3 === 0 ? "#ffffff" : index % 3 === 1 ? "#f8fafc" : "#fffaf0",
      logoPlacement: index % 3 === 0 ? "left" : index % 3 === 1 ? "center" : "right",
      columns: index % 4 === 0 ? ["description", "quantity", "unitPrice", "tax", "total"] : index % 4 === 1 ? ["sku", "description", "quantity", "total"] : index % 4 === 2 ? ["description", "taxableValue", "tax", "total"] : ["description", "quantity", "total"],
      signature: index % 2 === 0, paper: documentKind === "THERMAL_RECEIPT" ? index % 2 === 0 ? "58mm" : "80mm" : "A4",
    },
  })));
}

export function isGalleryKind(value: string): value is GalleryDocumentKind {
  return ["GST_INVOICE", "RETAIL_BILL", "THERMAL_RECEIPT", "QUOTATION", "PURCHASE_ORDER"].includes(value);
}
