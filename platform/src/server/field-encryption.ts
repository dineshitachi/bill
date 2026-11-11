import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const prefix = "enc:v1:";

function getEncryptionKey(): Buffer {
  const value = process.env.DATA_ENCRYPTION_KEY;
  if (!value) throw new Error("DATA_ENCRYPTION_KEY is not configured");
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new Error("DATA_ENCRYPTION_KEY must encode exactly 32 random bytes");
  return key;
}

export function encryptField(value: string): string {
  if (!value) return value;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${prefix}${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptField(value: string): string {
  if (!value || !value.startsWith(prefix)) return value;
  const [nonceText, tagText, ciphertextText, extra] = value.slice(prefix.length).split(":");
  if (!nonceText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error("Encrypted field has an invalid envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(nonceText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptInvoice<T extends {
  customerName: string;
  customerGstin: string;
  sellerBrandName: string;
  sellerLogoData: string;
  sellerLegalName: string;
  sellerGstin: string;
  paymentMethod: string;
  upiId: string;
}>(invoice: T, includeLogo = false): T {
  return {
    ...invoice,
    customerName: decryptField(invoice.customerName),
    customerGstin: decryptField(invoice.customerGstin),
    sellerBrandName: decryptField(invoice.sellerBrandName),
    sellerLogoData: includeLogo ? decryptField(invoice.sellerLogoData) : "",
    sellerLegalName: decryptField(invoice.sellerLegalName),
    sellerGstin: decryptField(invoice.sellerGstin),
    paymentMethod: decryptField(invoice.paymentMethod),
    upiId: decryptField(invoice.upiId),
  };
}

export function decryptPayment<T extends {
  paymentMethod: string;
  receivedBy: string;
}>(payment: T): T {
  return {
    ...payment,
    paymentMethod: decryptField(payment.paymentMethod),
    receivedBy: decryptField(payment.receivedBy),
  };
}

export function decryptInvoiceWithPayments<T extends {
  payments: Array<{ paymentMethod: string; receivedBy: string }>;
  customerName: string;
  customerGstin: string;
  sellerBrandName: string;
  sellerLogoData: string;
  sellerLegalName: string;
  sellerGstin: string;
  paymentMethod: string;
  upiId: string;
}>(invoice: T, includeLogo = false): T {
  return {
    ...decryptInvoice(invoice, includeLogo),
    payments: invoice.payments.map(decryptPayment),
  };
}

export function decryptCustomer<T extends {
  name: string;
  phone: string;
  email: string;
  gstin: string;
  state: string;
  stateCode: string;
  address: string;
}>(customer: T): T {
  return {
    ...customer,
    name: decryptField(customer.name),
    phone: decryptField(customer.phone),
    email: decryptField(customer.email),
    gstin: decryptField(customer.gstin),
    state: decryptField(customer.state),
    stateCode: decryptField(customer.stateCode),
    address: decryptField(customer.address),
  };
}

export function decryptTenant<T extends {
  name: string;
  legalName: string;
  gstin: string;
  upiId: string;
  logoData?: string;
}>(tenant: T): T {
  return {
    ...tenant,
    name: decryptField(tenant.name),
    legalName: decryptField(tenant.legalName),
    gstin: decryptField(tenant.gstin),
    upiId: decryptField(tenant.upiId),
    ...(tenant.logoData !== undefined ? { logoData: decryptField(tenant.logoData) } : {}),
  };
}
