import { calculateTax } from "@/gst";

export type TaxType = "GST" | "VAT" | "SALES_TAX";
export type TaxCalculation = {
  taxType: TaxType;
  rate: number;
  taxableValue: number;
  taxTotal: number;
  components: Array<{ name: string; rate: number; amount: number }>;
  jurisdiction: string;
};

export function calculateLocalizedTax(input: {
  amount: number;
  rate: number;
  taxType: TaxType;
  origin?: string;
  destination?: string;
  sellerStateCode?: string;
  placeOfSupplyStateCode?: string;
}): TaxCalculation {
  const amount = Math.round(input.amount * 100) / 100;
  const rate = Math.max(0, input.rate);
  if (input.taxType === "GST") {
    const result = calculateTax(1, amount, rate, input.sellerStateCode || input.origin || "", input.placeOfSupplyStateCode || input.destination || "");
    const components = result.igst > 0
      ? [{ name: "IGST", rate, amount: result.igst }]
      : [{ name: "CGST", rate: rate / 2, amount: result.cgst }, { name: "SGST", rate: rate / 2, amount: result.sgst }];
    return { taxType: input.taxType, rate, taxableValue: result.taxableValue, taxTotal: result.cgst + result.sgst + result.igst, components, jurisdiction: input.destination || input.placeOfSupplyStateCode || "" };
  }
  const taxTotal = Math.round(amount * rate) / 100;
  return {
    taxType: input.taxType, rate, taxableValue: amount, taxTotal,
    components: [{ name: input.taxType === "VAT" ? "VAT" : "Sales tax", rate, amount: taxTotal }],
    jurisdiction: input.destination || "",
  };
}
