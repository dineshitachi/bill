"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, BarChart3, Check, ChevronRight, CircleDollarSign,
  Download, FileText, LayoutDashboard, LogOut, Package, Plus, Printer, Receipt,
  MessageCircle, Mic, RotateCcw, Search, Settings2, ShieldCheck, ShoppingCart, Sparkles, Store, Trash2, Upload, Users, X,
  Wifi, WifiOff,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { allocateDiscountCents, calculateTax } from "@/gst";
import { ErrorBoundary } from "@/components/error-boundary";
import { CompanyLogoUpload } from "@/components/company-logo-upload";
import { registerFallback, startSelfHealingAgent } from "@/selfHealingAgent";
import { appearanceThemes, themes, type AppThemeName, type ThemeName } from "@/theme";
import { languageOptions, translate, type Language } from "@/i18n";
import { appStore, useAppStore } from "@/state/app-store";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { AgentGallery } from "@/components/agent-gallery";

const DynamicModuleWorkbenchView = dynamic(() => import("@/components/module-workbench").then((module) => module.ModuleWorkbenchView), { ssr: false });
const DynamicCashFlowForecastView = dynamic(() => import("@/components/cash-flow-forecast-view").then((module) => module.CashFlowForecastView), { ssr: false });
const DynamicWarehouseTransferView = dynamic(() => import("@/components/warehouse-transfer-view").then((module) => module.WarehouseTransferView), { ssr: false });
const DynamicPumpHeadSimulator = dynamic(() => import("@/components/pump-head-simulator").then((module) => module.PumpHeadSimulator), { ssr: false });
const DynamicModulePortfolioView = dynamic(() => import("@/components/module-portfolio-view").then((module) => module.ModulePortfolioView), { ssr: false });
const DynamicAdminDiagnosticsView = dynamic(() => import("@/components/admin-diagnostics-view").then((module) => module.AdminDiagnosticsView), { ssr: false });

type Role = "ADMIN" | "SALES" | "CUSTOMER";
type User = { id: string; username: string; displayName: string; role: Role; theme: AppThemeName; avatarData?: string; permissions?: string[] };
type Company = { name: string; legalName: string; gstin: string; stateCode: string; upiId: string; logoData: string; theme: ThemeName; lowStockNotifications: boolean; paymentNotifications: boolean };
type Product = { id: string; name: string; sku: string; unit: string; price: number; stock: number; lowStockAt: number; gstRate: number; hsnCode: string; inventoryValue?: number; lowStock?: boolean };
type Customer = { id: string; name: string; phone: string; email: string; gstin: string; state: string; stateCode: string; address: string };
type InvoiceItem = { id: string; productId: string | null; name: string; hsnCode: string; quantity: number | string; unitPrice: number | string; gstRate: number | string; taxableValue: number | string; cgst: number | string; sgst: number | string; igst: number | string; total: number | string };
type PaymentTransaction = { id: string; amount: number | string; paymentMethod: string; receivedBy: string; receivedAt: string; isLegacySnapshot: boolean };
type Invoice = {
  id: string; number: string; customerId: string | null; customerName: string; customerGstin: string;
  sellerBrandName: string; sellerLogoData: string; sellerLegalName: string; sellerGstin: string; sellerStateCode: string;
  placeOfSupplyStateCode: string; subtotal: number | string; discount: number | string; taxTotal: number | string;
  roundOff: number | string; grandTotal: number | string; amountPaid: number | string; paymentStatus: string;
  paymentMethod: string; upiId: string; theme: ThemeName; createdBy: string; issuedAt: string; items: InvoiceItem[]; payments: PaymentTransaction[];
};
type PaymentActivity = PaymentTransaction & { invoice: Invoice };
type AgentTask = {
  id: string;
  description: string;
  source: "TEXT" | "VOICE";
  screenshotMime: string | null;
  createdBy: string;
  status: "OPEN" | "REVIEWED" | "DISMISSED";
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};
type SpeechResultLike = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
type AuditEntry = { id: string; actorId: string; action: string; subject: string; details: unknown; createdAt: string };
type CustomerBalance = { customerId: string; billed: number; paid: number; due: number };
type Dashboard = {
  inventory: Product[]; lowStock: Product[]; customers: number;
  summary: { invoiceCount: number | null; salesToday: number | null; invoiceCountToday: number; inventoryValue: number | null };
  canViewFinancials: boolean;
};
type Tab = "dashboard" | "billing" | "invoices" | "inventory" | "quotation" | "product" | "low-stock" | "customers" | "payments" | "agent" | "team" | "settings" | "compliance" | "audit" | "operations" | "crm" | "vendors" | "expenses" | "reports" | "cash-flow" | "warehouses" | "pump-simulator" | "module-portfolio" | "diagnostics" | "notifications" | "regional" | "security" | "backups" | "integrations" | "templates" | "sales" | "pricing" | "notes" | "ledger" | "portal";
type BillLine = { productId: string; quantity: number };
type VoiceMessage = { role: "user" | "assistant"; content: string };
type VoiceDestination = "billing" | "quotation";
type ProductReturnTab = "billing" | "inventory" | "low-stock" | "quotation";
type ProductDraft = { name: string; sku: string; unit: string; price: string; stock: string; lowStockAt: string; gstRate: string; hsnCode: string };
type ApiResponse<T> = T;
type SearchResult = { id: string; title: string; detail: string; tab: Tab };
type BusinessMembership = { tenantId: string; role: Role; name: string; slug: string; legalName: string; gstin: string; logoData: string; active: boolean };
type SubscriptionState = { onboardingState: string; subscriptionStatus: string; planCode: "DEMO" | "TRIAL" | "FULL" | "SUSPENDED"; trialStartedAt: string; trialEndsAt: string | null; limits: { users: number; products: number; invoicesPerMonth: number }; features: Record<string, boolean>; daysRemaining: number | null; expired: boolean };

const stateOptions = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"],
  ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"],
  ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"],
  ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"],
  ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["28", "Andhra Pradesh"],
  ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"],
  ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"],
  ["38", "Ladakh"],
] as const;

const currentLocale = () => typeof document === "undefined" ? "en-IN" : document.documentElement.lang || "en-IN";
const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
const formatDate = (value: string | Date, dateOnly = false) =>
  new Intl.DateTimeFormat(currentLocale(), dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const numeric = (value: number | string | null | undefined) => Number(value || 0);
const whatsappUrl = (phone: string, message: string) => {
  let number = phone.replace(/\D/g, "");
  if (number.length === 10) number = `91${number}`;
  if (number.length === 11 && number.startsWith("0")) number = `91${number.slice(1)}`;
  return number.length >= 11 && number.length <= 15
    ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
    : "";
};
const invoiceWhatsAppUrl = (phone: string, message: string) => {
  let number = (phone || "").replace(/\D/g, "");
  if (number.length === 10) number = `91${number}`;
  if (number.length === 11 && number.startsWith("0")) number = `91${number.slice(1)}`;
  const recipient = number.length >= 11 && number.length <= 15 ? number : "";
  return `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`;
};

async function api<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

function csvCell(value: string): string {
  const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function downloadCsvFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="field-label">{label}</span>{children}</label>;
}

function LanguagePicker({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  return <label className="flex items-center gap-2">
    <span className="sr-only">{translate(language, "language")}</span>
    <select className="field !w-auto !py-2 text-xs" aria-label={translate(language, "language")} value={language}
      onChange={(event) => {
        const selected = languageOptions.find((option) => option.code === event.target.value);
        if (selected) onChange(selected.code);
      }}>
      {languageOptions.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}
    </select>
  </label>;
}

function StateSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
      {stateOptions.map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}
    </select>
  );
}

function Login({ language, onLanguageChange, onLogin }: { language: Language; onLanguageChange: (language: Language) => void; onLogin: (user: User, company: Company) => void }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [values, setValues] = useState({ tenant: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User; company: Company }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      onLogin(result.user, result.company);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendChatMessage(rawText: string, speakReply = false) {
    const text = rawText.trim();
    if (!text || voiceBusy) return;
    setVoiceBusy(true);
    setVoiceMessage("");
    setChatInput("");
    setChatMessages((current) => [...current, { role: "user", content: text }]);

    const command = /^(?:add|put|include)\s+(\d+)\s+(.+?)(?:\s+(?:to|in|into)\s+(?:the\s+)?(bill|quotation|quote))?(?:\s+draft)?[.!?]?$/i.exec(text);
    if (command) {
      const quantity = Number(command[1]);
      const requestedName = command[2].trim().toLocaleLowerCase();
      const target: VoiceDestination = command[3]
        ? (/^(?:quotation|quote)$/i.test(command[3]) ? "quotation" : "billing")
        : destination;
      const matches = products.filter((product) =>
        product.sku.trim().toLocaleLowerCase() === requestedName ||
        product.name.trim().toLocaleLowerCase() === requestedName,
      );
      const reply = matches.length === 1
        ? onStageLine(matches[0].id, quantity, target)
        : matches.length > 1
          ? "More than one item has that name. Use its exact SKU in the command so I can stage the right item."
          : "I could not find an exact SKU or item-name match. Check the catalog and try again.";
      setChatMessages((current) => [...current, { role: "assistant", content: reply }]);
      if (speakReply && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(reply);
        utterance.lang = languageOptions.find((option) => option.code === language)?.locale || navigator.language;
        window.speechSynthesis.speak(utterance);
      }
      setVoiceBusy(false);
      return;
    }

    const controller = new AbortController();
    chatAbort.current = controller;
    const history = [...chatMessages, { role: "user" as const, content: text }].slice(-20);
    setChatMessages((current) => [...current, { role: "assistant", content: "" }]);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: languageOptions.find((option) => option.code === language)?.label || language, messages: history }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const errorMessage = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
          ? body.error
          : `Voice assistant request failed (${response.status})`;
        throw new Error(errorMessage);
      }
      if (!response.body) throw new Error("Voice assistant did not return a response stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        buffer += decoder.decode(result.value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let event: { choices?: Array<{ delta?: { content?: string } }> };
          try {
            event = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          } catch {
            throw new Error("Voice assistant returned an invalid response stream");
          }
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            answer += delta;
            setChatMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", content: answer };
              return next;
            });
          }
        }
      }
      if (!answer.trim()) throw new Error("The AI provider returned an empty reply");
      if (speakReply && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(answer);
        utterance.lang = languageOptions.find((option) => option.code === language)?.locale || navigator.language;
        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setChatMessages((current) => current.at(-1)?.role === "assistant" && !current.at(-1)?.content
          ? current.slice(0, -1)
          : current);
        return;
      }
      setVoiceMessage(error instanceof Error ? error.message : "Voice assistant request failed");
      setChatMessages((current) => current.at(-1)?.role === "assistant" && !current.at(-1)?.content
        ? current.slice(0, -1)
        : current);
    } finally {
      if (chatAbort.current === controller) chatAbort.current = null;
      setVoiceBusy(false);
    }
  }

  function startConversationVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceMessage("Speech recognition is not available in this browser. You can type a message instead.");
      return;
    }
    const instance = new Recognition();
    recognition.current = instance;
    instance.lang = languageOptions.find((option) => option.code === language)?.locale || navigator.language || "en-IN";
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length - event.resultIndex }, (_, index) =>
        event.results[event.resultIndex + index][0]?.transcript || "",
      ).filter(Boolean).join(" ").trim();
      if (transcript) {
        setChatInput(transcript);
        void sendChatMessage(transcript, true);
      }
    };
    instance.onerror = (event) => setVoiceMessage(`Microphone recognition failed: ${event.error}`);
    instance.onend = () => setVoiceListening(false);
    setVoiceMessage("Listening for one request. Speech recognition follows your browser's configured service.");
    setVoiceListening(true);
    try {
      instance.start();
    } catch (error) {
      setVoiceListening(false);
      setVoiceMessage(error instanceof Error ? error.message : "Could not start speech recognition");
    }
  }

  return (
    <main className="login-screen">
      <motion.section className="panel login-card" initial={{ opacity: 0, y: 18, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 150, damping: 20 }}>
        <div className="mb-4 flex justify-end"><LanguagePicker language={language} onChange={onLanguageChange} /></div>
        <div className="brand-mark mb-6"><Receipt size={21} /></div>
        <p className="eyebrow">{t("businessPulse")}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{t("welcomeTitle")}</h1>
        <p className="muted mt-2 text-sm">{t("welcomeSubtitle")}</p>
        <form className="mt-7 space-y-4" onSubmit={submit}>
          <Field label={t("businessWorkspace")}>
            <input className="field" required name="tenant" autoComplete="organization" placeholder={t("workspaceSlug")} value={values.tenant} onChange={(e) => setValues({ ...values, tenant: e.target.value })} />
          </Field>
          <Field label={t("username")}>
            <input className="field" required name="username" type="text" autoComplete="username" value={values.username} onChange={(e) => setValues({ ...values, username: e.target.value })} />
          </Field>
          <Field label={t("password")}>
            <input className="field" name="password" type="password" required autoComplete="current-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
          </Field>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button className="button button-primary w-full" disabled={busy} data-resilient-action>
            {busy ? t("signingIn") : t("signInSecurely")} <ChevronRight size={17} />
          </button>
        </form>
        <p className="muted mt-6 text-center text-xs">{t("deploymentFooter")}</p>
      </motion.section>
    </main>
  );
}

function EWayBillDialog({ invoice, onClose, notify }: { invoice: Invoice; onClose: () => void; notify: (message: string) => void }) {
  type EWayRecord = { ewayBillNumber: string; status: string; transportMode: string; approximateDistance: number; vehicleNumber: string; transporterId: string; payload: unknown };
  const [record, setRecord] = useState<EWayRecord | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [action, setAction] = useState<"CREATE" | "UPDATE" | "CANCEL">("CREATE");
  const [mode, setMode] = useState("ROAD");
  const [distance, setDistance] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api<{ record: EWayRecord | null; providerConfigured: boolean }>(`/api/admin/compliance/eway?invoiceId=${encodeURIComponent(invoice.id)}`);
      setRecord(result.record);
      setProviderConfigured(result.providerConfigured);
      if (result.record) {
        setMode(result.record.transportMode || "ROAD");
        setDistance(result.record.approximateDistance ? String(result.record.approximateDistance) : "");
        setVehicleNumber(result.record.vehicleNumber || "");
        setTransporterId(result.record.transporterId || "");
        if (result.record.status === "SUBMITTED") setAction("UPDATE");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "E-Way status could not be loaded"); }
    finally { setLoading(false); }
  }, [invoice.id]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const body = action === "CANCEL"
        ? { action, invoiceId: invoice.id, reason }
        : { action, invoiceId: invoice.id, transport: { mode, approximateDistance: Number(distance), vehicleNumber, transporterId } };
      const result = await api<{ status: string; providerConfigured?: boolean; ewayBillNumber?: string }>("/api/admin/compliance/eway", { method: "POST", body: JSON.stringify(body) });
      notify(`E-Way bill: ${result.status}${result.ewayBillNumber ? ` · ${result.ewayBillNumber}` : result.providerConfigured === false ? " · payload prepared; no bill has been registered" : ""}`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "E-Way request failed"); }
    finally { setBusy(false); }
  }

  const canCreate = !record || ["READY", "FAILED", "CANCELLED"].includes(record.status);
  const canUpdateOrCancel = record?.status === "SUBMITTED" && Boolean(record.ewayBillNumber);
  const unresolved = ["SUBMITTING", "UPDATING", "CANCELLING", "UNKNOWN", "PROVIDER_ACCEPTED"].includes(record?.status || "");

  return <Modal title={`E-Way bill · ${invoice.number}`} onClose={onClose}>
    {loading ? <p className="muted text-sm" role="status">Loading provider status...</p> : <>
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="mb-4 rounded-lg border border-[var(--line)] p-3 text-sm">
        <p>Status: <strong>{record?.status || "Not prepared"}</strong>{record?.ewayBillNumber ? ` · E-Way no. ${record.ewayBillNumber}` : ""}</p>
        {!providerConfigured && <p className="muted mt-1">No authorized provider is configured. You can prepare a payload, but registration, update, and cancellation are unavailable.</p>}
        {record?.status === "UNKNOWN" && <p className="mt-1 text-amber-700">Provider outcome is unresolved. Reconcile with the provider before retrying.</p>}
        {record?.status === "PROVIDER_ACCEPTED" && <p className="mt-1 text-amber-700">Provider accepted the request but did not return an E-Way number. Reconcile before another action.</p>}
      </div>
      {unresolved ? <div className="flex justify-end"><button className="button button-soft" onClick={() => void load()}>Refresh status</button></div> : <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        {canUpdateOrCancel && <label className="block"><span className="field-label">Action</span><select className="field" value={action} onChange={(event) => setAction(event.target.value as "UPDATE" | "CANCEL")}><option value="UPDATE">Update transport details</option><option value="CANCEL">Cancel E-Way bill</option></select></label>}
        {action === "CANCEL" ? <label className="block"><span className="field-label">Cancellation reason</span><textarea className="field min-h-20" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : <>
          <label className="block"><span className="field-label">Transport mode</span><select className="field" value={mode} onChange={(event) => setMode(event.target.value)}><option value="ROAD">Road</option><option value="RAIL">Rail</option><option value="AIR">Air</option><option value="SHIP">Ship</option></select></label>
          <label className="block"><span className="field-label">Approximate distance (km)</span><input className="field" type="number" min="1" max="4000" step="1" required value={distance} onChange={(event) => setDistance(event.target.value)} /></label>
          <label className="block"><span className="field-label">Vehicle number</span><input className="field" maxLength={20} value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())} /></label>
          <label className="block"><span className="field-label">Transporter ID</span><input className="field" maxLength={20} value={transporterId} onChange={(event) => setTransporterId(event.target.value.toUpperCase())} /></label>
          {mode === "ROAD" && !vehicleNumber && !transporterId && <p className="text-xs text-amber-700">Enter a vehicle number or transporter ID for road transport.</p>}
        </>}
        <div className="flex justify-end gap-2"><button type="button" className="button button-quiet" onClick={onClose}>Close</button><button className="button button-primary" disabled={busy || (!canCreate && !canUpdateOrCancel) || (action === "CANCEL" && !canUpdateOrCancel) || (action !== "CANCEL" && mode === "ROAD" && !vehicleNumber && !transporterId) || (!providerConfigured && action !== "CREATE")}>{busy ? "Submitting..." : action === "CREATE" ? "Prepare / submit" : action === "UPDATE" ? "Update provider record" : "Cancel provider record"}</button></div>
      </form>}
      {record?.payload && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">View generated JSON</summary><pre className="muted mt-2 max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(record.payload, null, 2)}</pre></details>}
    </>}
  </Modal>;
}

function InvoicePreview({ invoice, company, customers, onClose, onExport, onEInvoice, onEWay }: { invoice: Invoice; company: Company; customers: Customer[]; onClose: () => void; onExport: (invoice: Invoice) => void; onEInvoice: (invoice: Invoice) => void; onEWay: (invoice: Invoice) => void }) {
  const [invoiceLogo, setInvoiceLogo] = useState(invoice.sellerLogoData);
  const [logoError, setLogoError] = useState("");
  useEffect(() => {
    setInvoiceLogo(invoice.sellerLogoData);
    setLogoError("");
    if (invoice.sellerLogoData) return;
    let active = true;
    api<{ logoData: string }>(`/api/invoices/${invoice.id}/logo`)
      .then(({ logoData }) => { if (active) setInvoiceLogo(logoData); })
      .catch((error: unknown) => {
        console.error("Could not load the invoice logo", error);
        if (active) setLogoError("The company logo could not be loaded for this invoice.");
      });
    return () => { active = false; };
  }, [invoice.id, invoice.sellerLogoData]);
  const sellerBrandName = invoice.sellerBrandName || company.name;
  const sellerLegalName = invoice.sellerLegalName || company.legalName;
  const sellerGstin = invoice.sellerGstin || company.gstin;
  const sellerStateCode = invoice.sellerStateCode || company.stateCode;
  const customerPhone = customers.find((customer) => customer.id === invoice.customerId)?.phone || "";
  const balanceDue = Math.max(0, numeric(invoice.grandTotal) - numeric(invoice.amountPaid));
  const payUrl = invoice.upiId && balanceDue > 0
    ? `upi://pay?pa=${encodeURIComponent(invoice.upiId)}&pn=${encodeURIComponent(sellerLegalName)}&am=${balanceDue.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.number)}`
    : "";
  const whatsappMessage = [
    `Invoice ${invoice.number} from ${sellerBrandName || sellerLegalName}`,
    `Customer: ${invoice.customerName}`,
    ...invoice.items.slice(0, 20).map((item) => `${item.name} × ${numeric(item.quantity)} — ${money(item.total)}`),
    invoice.items.length > 20 ? `…and ${invoice.items.length - 20} more item(s)` : "",
    `Total: ${money(invoice.grandTotal)}`,
    `Received: ${money(invoice.amountPaid)}`,
    `Balance due: ${money(balanceDue)}`,
    `Payment status: ${invoice.paymentStatus}`,
    payUrl ? `Pay by UPI: ${payUrl}` : "",
    "A detailed invoice PDF is available from the billing app.",
  ].filter(Boolean).join("\n");
  const whatsappShareUrl = invoiceWhatsAppUrl(customerPhone, whatsappMessage);
  const hsnTotals = Object.entries(invoice.items.reduce<Record<string, { taxable: number; cgst: number; sgst: number; igst: number }>>((acc, item) => {
    const code = item.hsnCode || "—";
    acc[code] ||= { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    acc[code].taxable += numeric(item.taxableValue);
    acc[code].cgst += numeric(item.cgst);
    acc[code].sgst += numeric(item.sgst);
    acc[code].igst += numeric(item.igst);
    return acc;
  }, {}));

  return (
    <div className="modal-backdrop invoice-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.div className="max-h-[95vh] w-full overflow-auto" initial={{ opacity: 0, y: 14, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <div className="no-print mx-auto mb-3 flex max-w-[820px] flex-wrap justify-end gap-2">
          <button className="button button-soft" onClick={() => onExport(invoice)} data-resilient-action><Download size={16} /> Excel</button>
          <button className="button button-soft" onClick={() => onEInvoice(invoice)} data-resilient-action>E-invoice</button>
          <button className="button button-soft" onClick={() => onEWay(invoice)} data-resilient-action>E-way bill</button>
          <a className="button button-soft" href={whatsappShareUrl} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Share on WhatsApp</a>
          <button className="button button-soft" onClick={() => window.print()} data-resilient-action><Printer size={16} /> Save detailed PDF</button>
          <button className="button button-quiet bg-white" onClick={onClose} aria-label="Close preview"><X size={18} /></button>
        </div>
        <article className={`invoice-paper mx-auto theme-${invoice.theme}`}>
          <header className="invoice-header">
            <div>
              {invoiceLogo && <img src={invoiceLogo} alt={`${sellerBrandName || sellerLegalName} logo`} className="invoice-company-logo mb-3" />}
              {logoError && <p className="mb-2 text-xs text-amber-700">{logoError}</p>}
              <span className="invoice-accent">{themes[invoice.theme]?.label || "GST Invoice"}</span>
              <h1 className="mt-4 text-2xl font-bold">{sellerLegalName}</h1>
              {sellerBrandName && sellerBrandName !== sellerLegalName && <p className="mt-1 text-sm text-gray-500">Trading as {sellerBrandName}</p>}
              <p className="mt-2 text-sm text-gray-600">{sellerGstin && <>GSTIN: {sellerGstin}<br /></>}State code: {sellerStateCode}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-gray-400">Tax invoice</p>
              <h2 className="mt-2 text-lg font-bold">{invoice.number}</h2>
              <p className="mt-1 text-sm text-gray-500">{formatDate(invoice.issuedAt)}</p>
              <span className={`tag mt-3 tag-${invoice.paymentStatus.toLowerCase()}`}>{invoice.paymentStatus}</span>
            </div>
          </header>
          <section className="invoice-meta">
            <div><p className="eyebrow">Bill to</p><p className="mt-2 font-semibold">{invoice.customerName}</p>{invoice.customerGstin && <p className="mt-1 text-sm text-gray-500">GSTIN {invoice.customerGstin}</p>}</div>
            <div><p className="eyebrow">Place of supply</p><p className="mt-2 font-semibold">{stateOptions.find(([code]) => code === invoice.placeOfSupplyStateCode)?.[1] || invoice.placeOfSupplyStateCode}</p><p className="mt-1 text-sm text-gray-500">{invoice.createdBy}</p></div>
          </section>
          <div className="table-wrap">
            <table className="simple-table">
              <thead><tr className="table-row"><th>Item / HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead>
              <tbody>{invoice.items.map((item) => <tr className="table-row" key={item.id}>
                <td><span className="font-semibold">{item.name}</span><small className="block text-gray-500">HSN/SAC {item.hsnCode || "—"} · GST {numeric(item.gstRate)}%</small></td>
                <td>{numeric(item.quantity)}</td><td>{money(item.unitPrice)}</td><td>{money(item.taxableValue)}</td>
                <td>{money(item.cgst)}</td><td>{money(item.sgst)}</td><td>{money(item.igst)}</td><td className="font-semibold">{money(item.total)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="invoice-meta items-start">
            <div>
              <p className="eyebrow">HSN / tax summary</p>
              <div className="mt-2 space-y-2 text-sm">{hsnTotals.map(([hsn, values]) => <p key={hsn} className="flex justify-between gap-5">
                <span>HSN {hsn} · taxable {money(values.taxable)}</span>
                <span>{money(values.cgst + values.sgst + values.igst)} tax</span>
              </p>)}</div>
            </div>
            <div className="invoice-total space-y-2 text-sm">
              <p className="flex justify-between"><span>Subtotal</span><span>{money(invoice.subtotal)}</span></p>
              <p className="flex justify-between"><span>Discount</span><span>− {money(invoice.discount)}</span></p>
              {invoice.items.some((item) => numeric(item.igst) > 0)
                ? <p className="flex justify-between"><span>IGST</span><span>{money(invoice.items.reduce((sum, item) => sum + numeric(item.igst), 0))}</span></p>
                : <><p className="flex justify-between"><span>CGST</span><span>{money(invoice.items.reduce((sum, item) => sum + numeric(item.cgst), 0))}</span></p><p className="flex justify-between"><span>SGST</span><span>{money(invoice.items.reduce((sum, item) => sum + numeric(item.sgst), 0))}</span></p></>}
              <p className="flex justify-between"><span>Round off</span><span>{money(invoice.roundOff)}</span></p>
              <p className="flex justify-between border-t border-gray-200 pt-3 text-lg font-bold"><span>Total</span><span>{money(invoice.grandTotal)}</span></p>
              <p className="flex justify-between text-gray-500"><span>Paid · {invoice.paymentMethod || "—"}</span><span>{money(invoice.amountPaid)}</span></p>
              <p className="flex justify-between font-semibold text-gray-700"><span>Balance due</span><span>{money(balanceDue)}</span></p>
            </div>
          </div>
          <section className="mt-6 border-t border-gray-200 pt-4">
            <p className="eyebrow">Payment history</p>
            {invoice.payments.length > 0 ? <div className="table-wrap mt-2">
              <table className="simple-table">
                <thead><tr className="table-row"><th>Received</th><th>Amount</th><th>Method</th><th>Recorded by</th></tr></thead>
                <tbody>{invoice.payments.map((payment) => <tr className="table-row" key={payment.id}>
                  <td>{formatDate(payment.receivedAt)}</td><td>{money(payment.amount)}</td><td>{payment.isLegacySnapshot ? "Opening balance snapshot" : payment.paymentMethod || "—"}</td><td>{payment.receivedBy}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="muted mt-2 text-sm">No payment transactions have been recorded for this invoice.</p>}
          </section>
          {payUrl && <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-5">
            <div><p className="font-semibold">Pay by UPI</p><p className="mt-1 text-sm text-gray-500">{invoice.upiId}</p></div>
            <QRCodeSVG value={payUrl} size={104} level="M" includeMargin />
          </div>}
          <footer className="mt-8 border-t border-gray-200 pt-4 text-center text-xs text-gray-400">Thank you for your business · Generated by Namma Bill POS</footer>
        </article>
      </motion.div>
    </div>
  );
}

function BillingAppInner() {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const appTheme = useAppStore((state) => state.theme);
  const setAppTheme = appStore.setTheme;
  const [starting, setStarting] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [language, setLanguage] = useState<Language>("en");
  const tab = useAppStore((state) => state.activeView) as Tab;
  const setTab = appStore.setActiveView;
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<Invoice[]>([]);
  const [completedInvoices, setCompletedInvoices] = useState<Invoice[]>([]);
  const [recentPayments, setRecentPayments] = useState<PaymentActivity[]>([]);
  const [paymentSummary, setPaymentSummary] = useState({ totalBilled: 0, totalReceived: 0, pendingCount: 0, completedCount: 0 });
  const [customerBalances, setCustomerBalances] = useState<CustomerBalance[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [toast, setToast] = useState("");
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [ewayInvoice, setEwayInvoice] = useState<Invoice | null>(null);
  const search = useAppStore((state) => state.globalSearch);
  const setSearch = appStore.setGlobalSearch;
  const [remoteSearchResults, setRemoteSearchResults] = useState<SearchResult[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productReturnTab, setProductReturnTab] = useState<ProductReturnTab>("inventory");
  const [customerModal, setCustomerModal] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [userModal, setUserModal] = useState(false);
  const [rotatedKey, setRotatedKey] = useState("");
  const [businesses, setBusinesses] = useState<BusinessMembership[]>([]);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [newProduct, setNewProduct] = useState<ProductDraft>({ name: "", sku: "", unit: "pcs", price: "", stock: "", lowStockAt: "5", gstRate: "18", hsnCode: "" });
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", email: "", gstin: "", state: "", stateCode: "33", address: "" });
  const [newUser, setNewUser] = useState({ username: "", displayName: "", password: "", role: "SALES" as Role, customerId: "" });
  const [lines, setLines] = useState<BillLine[]>([]);
  const [quoteLines, setQuoteLines] = useState<BillLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState("33");
  const [discount, setDiscount] = useState("0");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [customCheckoutMethod, setCustomCheckoutMethod] = useState("");
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [recordPaymentMethod, setRecordPaymentMethod] = useState("Cash");
  const [customPaymentMethod, setCustomPaymentMethod] = useState("");
  const previousLowStockIds = useRef<Set<string> | null>(null);
  const syncErrorNotified = useRef(false);
  const restoringRoute = useRef(false);
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3800);
  }, []);
  const changeLanguage = useCallback((nextLanguage: Language) => {
    const selected = languageOptions.find((option) => option.code === nextLanguage);
    if (!selected) return;
    document.documentElement.lang = selected.locale;
    setLanguage(selected.code);
    try {
      window.localStorage.setItem("namma_bill_language", selected.code);
    } catch (error) {
      console.error("Could not save the language preference", error);
      notify("Language changed for this session, but browser storage is unavailable.");
    }
  }, [notify]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    try {
      const savedLanguage = window.localStorage.getItem("namma_bill_language");
      const selected = languageOptions.find((option) => option.code === savedLanguage);
      if (selected) {
        document.documentElement.lang = selected.locale;
        setLanguage(selected.code);
      }
    } catch (error) {
      console.error("Could not load the saved language preference", error);
      notify("Language preference could not be loaded from this browser.");
    }
  }, [notify]);

  useEffect(() => {
    const selected = languageOptions.find((option) => option.code === language);
    if (selected) document.documentElement.lang = selected.locale;
  }, [language]);

  useEffect(() => {
    const route = new URL(window.location.href).searchParams.get("view") as Tab | null;
    const validTabs: Tab[] = ["dashboard", "billing", "invoices", "inventory", "quotation", "product", "low-stock", "customers", "payments", "agent", "team", "settings", "compliance", "audit", "operations", "crm", "vendors", "expenses", "reports", "cash-flow", "warehouses", "pump-simulator", "module-portfolio", "diagnostics", "notifications", "regional", "security", "backups", "integrations", "templates", "sales", "pricing", "notes", "ledger", "portal"];
    if (route && validTabs.includes(route)) setTab(route);
    const onPopState = () => {
      const next = new URL(window.location.href).searchParams.get("view") as Tab | null;
      if (next && validTabs.includes(next)) {
        restoringRoute.current = true;
        setTab(next);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (restoringRoute.current) {
      restoringRoute.current = false;
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", tab);
    window.history.pushState({}, "", url);
  }, [tab, user]);

  useEffect(() => {
    if (!user) return;
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "/" && user.role !== "CUSTOMER") { event.preventDefault(); document.querySelector<HTMLInputElement>("[aria-label='Global search']")?.focus(); }
      if (event.key.toLowerCase() === "n" && user.role !== "CUSTOMER") setTab("billing");
      if (event.key.toLowerCase() === "g") setTab("dashboard");
      if (event.key.toLowerCase() === "i" && user.role !== "CUSTOMER") setTab("inventory");
      if (event.key.toLowerCase() === "q" && user.role !== "CUSTOMER") setTab("quotation");
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [user]);

  useEffect(() => startSelfHealingAgent(), []);

  const reload = useCallback(async (role: Role) => {
    try {
      const [dashboardData, productData, customerData, invoiceData, accountData] = await Promise.all([
        api<{ dashboard?: Dashboard } & Dashboard>("/api/dashboard"),
        api<{ products: Product[] }>("/api/products"),
        api<{ customers: Customer[] }>("/api/customers"),
        api<{ invoices: Invoice[] }>("/api/invoices"),
        role === "ADMIN"
          ? api<{ balances: CustomerBalance[]; pendingInvoices: Invoice[]; completedInvoices: Invoice[]; recentPayments: PaymentActivity[]; paymentSummary: typeof paymentSummary }>("/api/customer-balances")
          : Promise.resolve(null),
      ]);
      setDashboard(dashboardData as Dashboard);
      setProducts(productData.products.map((item) => ({
        ...item, price: numeric(item.price), stock: numeric(item.stock), lowStockAt: numeric(item.lowStockAt), gstRate: numeric(item.gstRate),
      })));
      setCustomers(customerData.customers);
      setInvoices(invoiceData.invoices);
      setPendingInvoices(accountData?.pendingInvoices || []);
      setCompletedInvoices(accountData?.completedInvoices || []);
      setRecentPayments(accountData?.recentPayments || []);
      setPaymentSummary(accountData?.paymentSummary || { totalBilled: 0, totalReceived: 0, pendingCount: 0, completedCount: 0 });
      setCustomerBalances(accountData?.balances || []);
      if (role === "ADMIN") {
        const [teamData, auditData] = await Promise.all([
          api<{ users: User[] }>("/api/admin/users"),
          api<{ entries: AuditEntry[] }>("/api/admin/audit"),
        ]);
        setUsers(teamData.users);
        setAuditEntries(auditData.entries);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load billing data");
    }
  }, [notify]);

  useEffect(() => registerFallback("refresh-workspace", () => {
    if (user && user.role !== "CUSTOMER") return reload(user.role);
    window.location.reload();
  }), [reload, user]);

  useEffect(() => {
    let active = true;
    api<{ user: User; company: Company }>("/api/auth/me")
      .then(async (result) => {
        if (!active) return;
        let theme = result.user.theme;
        try {
          const localTheme = window.localStorage.getItem(`namma_bill_theme_${result.user.id}`);
          if (localTheme && Object.keys(appearanceThemes).includes(localTheme) && localTheme !== theme) {
            try {
              const profile = await api<{ theme: AppThemeName }>("/api/profile", {
                method: "PUT",
                body: JSON.stringify({ theme: localTheme }),
              });
              theme = profile.theme;
            } catch (error) {
              console.error("Could not sync the local theme preference", error);
              notify("Using your saved profile theme; local theme could not be synchronized.");
            }
          }
        } catch (error) {
          console.error("Could not load the saved theme preference", error);
          notify("Theme preference could not be loaded from this browser.");
        }
        if (!active) return;
        setUser({ ...result.user, theme });
        setCompany(result.company);
        setAppTheme(theme);
        setTab(result.user.role === "CUSTOMER" ? "portal" : "dashboard");
        try {
          window.localStorage.setItem(`namma_bill_theme_${result.user.id}`, theme);
        } catch (error) {
          console.error("Could not save the profile theme preference", error);
          notify("Theme is saved to your profile, but browser storage is unavailable.");
        }
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => { if (active) setStarting(false); });
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    if (user && user.role !== "CUSTOMER") void reload(user.role);
  }, [user, reload]);

  useEffect(() => {
    if (!user) return;
    setProfileName(user.displayName);
    setProfileAvatar(user.avatarData || "");
    api<{ businesses: BusinessMembership[] }>("/api/businesses").then((result) => setBusinesses(result.businesses)).catch(() => setBusinesses([]));
    api<{ subscription: SubscriptionState }>("/api/subscription").then((result) => setSubscription(result.subscription)).catch(() => setSubscription(null));
  }, [user]);

  useEffect(() => {
    if (!user || user.role === "CUSTOMER") return;
    let active = true;
    let syncing = false;
    const sync = async () => {
      if (syncing || document.visibilityState !== "visible") return;
      syncing = true;
      try {
        const [dashboardData, customerData, invoiceData, accountData] = await Promise.all([
          api<Dashboard>("/api/dashboard"),
          api<{ customers: Customer[] }>("/api/customers"),
          api<{ invoices: Invoice[] }>("/api/invoices"),
          user.role === "ADMIN"
            ? api<{ balances: CustomerBalance[]; pendingInvoices: Invoice[]; completedInvoices: Invoice[]; recentPayments: PaymentActivity[]; paymentSummary: typeof paymentSummary }>("/api/customer-balances")
            : Promise.resolve(null),
        ]);
        if (!active) return;
        setDashboard(dashboardData);
        setProducts(dashboardData.inventory);
        setCustomers(customerData.customers);
        setInvoices(invoiceData.invoices);
        setCustomerBalances(accountData?.balances || []);
        setPendingInvoices(accountData?.pendingInvoices || []);
        setCompletedInvoices(accountData?.completedInvoices || []);
        setRecentPayments(accountData?.recentPayments || []);
        setPaymentSummary(accountData?.paymentSummary || { totalBilled: 0, totalReceived: 0, pendingCount: 0, completedCount: 0 });
        if (syncErrorNotified.current) notify("Live workspace sync restored.");
        syncErrorNotified.current = false;
      } catch (error) {
        if (active && !syncErrorNotified.current) {
          notify(error instanceof Error ? error.message : "Live workspace sync failed");
          syncErrorNotified.current = true;
        }
      } finally {
        syncing = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const timer = window.setInterval(() => void sync(), 5_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [user, notify]);

  useEffect(() => {
    if (!user || user.role === "CUSTOMER" || search.trim().length < 2) {
      setRemoteSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(search.trim())}`, { signal: controller.signal })
        .then((result) => setRemoteSearchResults(result.results))
        .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setRemoteSearchResults([]); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, user]);

  useEffect(() => {
    if (!dashboard) return;
    const currentIds = new Set(dashboard.lowStock.map((item) => item.id));
    if (previousLowStockIds.current && company?.lowStockNotifications && "Notification" in window && Notification.permission === "granted") {
      dashboard.lowStock
        .filter((item) => !previousLowStockIds.current?.has(item.id))
        .forEach((item) => new Notification(`Low stock: ${item.name}`, { body: `${item.stock} ${item.unit} available · alert at ${item.lowStockAt}.` }));
    }
    previousLowStockIds.current = currentIds;
  }, [dashboard, company]);

  const billTotals = useMemo(() => {
    const items = lines.flatMap((line) => {
      const product = products.find((candidate) => candidate.id === line.productId);
      if (!product || line.quantity <= 0) return [];
      const gross = Math.round(line.quantity * product.price * 100) / 100;
      return [{ product, quantity: line.quantity, gross }];
    });
    const subtotal = items.reduce((sum, item) => sum + item.gross, 0);
    const discountValue = Math.round(Math.min(Math.max(0, Number(discount) || 0), subtotal) * 100) / 100;
    const discountAllocations = allocateDiscountCents(discountValue, items.map((item) => item.gross));
    const taxes = items.map((item, index) => {
      const lineDiscount = discountAllocations[index] / 100;
      return calculateTax(1, item.gross - lineDiscount, item.product.gstRate, company?.stateCode || "33", placeOfSupplyStateCode);
    });
    const taxable = taxes.reduce((sum, item) => sum + item.taxableValue, 0);
    const tax = taxes.reduce((sum, item) => sum + item.cgst + item.sgst + item.igst, 0);
    const exact = taxable + tax;
    const grandTotal = Math.round(exact);
    return { items, subtotal, discount: discountValue, taxable, tax, grandTotal, roundOff: grandTotal - exact };
  }, [lines, products, discount, company?.stateCode, placeOfSupplyStateCode]);

  const visibleInvoices = useMemo(() => invoices.filter((invoice) => {
    const date = invoice.issuedAt.slice(0, 10);
    const matchesDate = (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    const term = search.trim().toLowerCase();
    const matchesTerm = !term || `${invoice.number} ${invoice.customerName} ${invoice.paymentStatus}`.toLowerCase().includes(term);
    return matchesDate && matchesTerm;
  }), [invoices, fromDate, toDate, search]);

  const globalSearchResults = useMemo<SearchResult[]>(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return [...remoteSearchResults, ...[
      ...products.filter((item) => `${item.name} ${item.sku} ${item.hsnCode}`.toLowerCase().includes(term)).map((item) => ({ id: item.id, title: item.name, detail: `SKU ${item.sku} · Inventory`, tab: "inventory" as Tab })),
      ...customers.filter((item) => `${item.name} ${item.phone} ${item.email} ${item.gstin}`.toLowerCase().includes(term)).map((item) => ({ id: item.id, title: item.name, detail: `${item.phone || "Customer"} · Directory`, tab: "customers" as Tab })),
      ...invoices.filter((item) => `${item.number} ${item.customerName} ${item.paymentStatus}`.toLowerCase().includes(term)).map((item) => ({ id: item.id, title: item.number, detail: `${item.customerName} · ${money(item.grandTotal)}`, tab: "invoices" as Tab })),
    ]].slice(0, 8);
  }, [search, products, customers, invoices, remoteSearchResults]);

  async function afterLogin(nextUser: User, nextCompany: Company) {
    setUser(nextUser);
    setCompany(nextCompany);
    setAppTheme(nextUser.theme);
    try {
      window.localStorage.setItem(`namma_bill_theme_${nextUser.id}`, nextUser.theme);
    } catch (error) {
      console.error("Could not save the profile theme preference", error);
      notify("Theme is saved to your profile, but browser storage is unavailable.");
    }
    setTab(nextUser.role === "CUSTOMER" ? "portal" : "dashboard");
  }

  async function saveAppearanceTheme(theme: AppThemeName) {
    if (!user) return;
    try {
      const result = await api<{ theme: AppThemeName }>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ theme }),
      });
      setAppTheme(result.theme);
      setUser((current) => current ? { ...current, theme: result.theme } : current);
      try {
        window.localStorage.setItem(`namma_bill_theme_${user.id}`, result.theme);
      } catch (error) {
        console.error("Could not save the profile theme preference", error);
        notify("Theme saved to your profile, but browser storage is unavailable.");
        return;
      }
      notify(`${appearanceThemes[result.theme].label} theme saved`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save theme preference");
    }
  }

  async function saveInlineProfile() {
    const displayName = profileName.trim();
    if (!user || displayName.length < 2) return notify("Enter a valid display name");
    try {
      const result = await api<{ profile?: { avatarData?: string } }>("/api/profile", { method: "PUT", body: JSON.stringify({ displayName, avatarData: profileAvatar }) });
      setUser((current) => current ? { ...current, displayName, avatarData: result.profile?.avatarData ?? current.avatarData } : current);
      setProfileEditing(false);
      notify("Profile updated");
    } catch (error) { notify(error instanceof Error ? error.message : "Profile could not be updated"); }
  }

  async function switchBusiness(tenantId: string) {
    try {
      await api("/api/businesses", { method: "POST", body: JSON.stringify({ tenantId }) });
      window.location.reload();
    } catch (error) { notify(error instanceof Error ? error.message : "Business switch failed"); }
  }

  async function upgradeToFullAccess() {
    try {
      const result = await api<{ subscription: SubscriptionState }>("/api/subscription", { method: "POST", body: JSON.stringify({ planCode: "FULL" }) });
      setSubscription(result.subscription); setUpgradeOpen(false); notify("Full access is now enabled for this business");
    } catch (error) { notify(error instanceof Error ? error.message : "Upgrade could not be completed"); }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setUser(null);
      setCompany(null);
      setDashboard(null);
      setSubscription(null);
      setAppTheme("slate");
      appStore.resetTransientState();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not sign out");
    }
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(editingProductId ? `/api/products/${editingProductId}` : "/api/products", {
        method: editingProductId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...newProduct,
          price: Number(newProduct.price),
          stock: Number(newProduct.stock),
          lowStockAt: Number(newProduct.lowStockAt),
          gstRate: Number(newProduct.gstRate),
        }),
      });
      setEditingProductId(null);
      setNewProduct({ name: "", sku: "", unit: "pcs", price: "", stock: "", lowStockAt: "5", gstRate: "18", hsnCode: "" });
      if (user) await reload(user.role);
      setTab(productReturnTab);
      notify(editingProductId ? "Inventory item updated" : "Item added to inventory");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not save product"); }
    finally { setBusy(false); }
  }

  function startProductCreate(returnTab: ProductReturnTab) {
    setNewProduct({ name: "", sku: "", unit: "pcs", price: "", stock: "", lowStockAt: "5", gstRate: "18", hsnCode: "" });
    setEditingProductId(null);
    setProductReturnTab(returnTab);
    setTab("product");
  }

  function editProduct(product: Product, returnTab: ProductReturnTab = "inventory") {
    setNewProduct({
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      price: String(product.price),
      stock: String(product.stock),
      lowStockAt: String(product.lowStockAt),
      gstRate: String(product.gstRate),
      hsnCode: product.hsnCode,
    });
    setEditingProductId(product.id);
    setProductReturnTab(returnTab);
    setTab("product");
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Remove ${product.name}? Items already invoiced cannot be deleted.`)) return;
    try {
      await api(`/api/products/${product.id}`, { method: "DELETE" });
      if (user) await reload(user.role);
      notify("Item removed from inventory");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not remove item"); }
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ customer: Customer }>(editingCustomerId ? `/api/customers/${editingCustomerId}` : "/api/customers", { method: editingCustomerId ? "PATCH" : "POST", body: JSON.stringify(newCustomer) });
      setCustomers((current) => (editingCustomerId ? current.map((item) => item.id === result.customer.id ? result.customer : item) : [...current, result.customer]).sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(result.customer.id);
      setCustomerModal(false);
      setEditingCustomerId(null);
      setNewCustomer({ name: "", phone: "", email: "", gstin: "", state: "", stateCode: "33", address: "" });
      notify(editingCustomerId ? "Customer updated" : "Customer saved");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not save customer"); }
    finally { setBusy(false); }
  }

  function editCustomer(customer: Customer) {
    setEditingCustomerId(customer.id);
    setNewCustomer({ name: customer.name, phone: customer.phone, email: customer.email, gstin: customer.gstin, state: customer.state, stateCode: customer.stateCode, address: customer.address });
    setCustomerModal(true);
  }

  async function deleteCustomer(customer: Customer) {
    if (!window.confirm(`Remove ${customer.name}? Customers with invoices cannot be deleted.`)) return;
    try {
      await api(`/api/customers/${customer.id}`, { method: "DELETE" });
      setCustomers((current) => current.filter((item) => item.id !== customer.id));
      notify("Customer removed");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not remove customer"); }
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ user: User }>("/api/admin/users", { method: "POST", body: JSON.stringify(newUser) });
      setUsers((current) => [...current, result.user]);
      setUserModal(false);
      setNewUser({ username: "", displayName: "", password: "", role: "SALES", customerId: "" });
      notify("Team account created");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not create account"); }
    finally { setBusy(false); }
  }

  async function removeUser(target: User) {
    if (!window.confirm(`Permanently remove ${target.displayName} (${target.username})? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users?id=${encodeURIComponent(target.id)}`, { method: "DELETE" });
      setUsers((current) => current.filter((entry) => entry.id !== target.id));
      notify("Account permanently removed");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not remove account"); }
  }

  async function saveCompany(event: FormEvent) {
    event.preventDefault();
    if (!company) return;
    setBusy(true);
    try {
      const result = await api<{ company: Company }>("/api/admin/company", { method: "PUT", body: JSON.stringify(company) });
      setCompany(result.company);
      notify("Branding and business settings saved");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not save settings"); }
    finally { setBusy(false); }
  }

  async function verifyGstin() {
    if (!company?.gstin) return notify("Enter a GSTIN first");
    try {
      const result = await api<{ message: string; governmentVerified: boolean }>("/api/gst/verify", {
        method: "POST", body: JSON.stringify({ gstin: company.gstin }),
      });
      notify(result.message);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not verify GSTIN"); }
  }

  async function checkout(event: FormEvent) {
    event.preventDefault();
    if (!billTotals.items.length) return notify("Add at least one product to the bill");
    const checkoutMethod = paymentMethod === "Custom" ? customCheckoutMethod.trim() : paymentMethod;
    if (!checkoutMethod || checkoutMethod.length > 40) return notify("Enter a valid payment method");
    setBusy(true);
    try {
      const result = await api<{ invoice: Invoice; ledgerCsv: string }>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId: customerId || undefined,
          placeOfSupplyStateCode,
          discount: billTotals.discount,
          amountPaid: Number(amountPaid) || 0,
          paymentMethod: checkoutMethod,
          items: billTotals.items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        }),
      });
      downloadCsvFile(`${result.invoice.number}-ledger.csv`, result.ledgerCsv);
      setPreview(result.invoice);
      setLines([]);
      setDiscount("0");
      setAmountPaid("");
      setCustomCheckoutMethod("");
      if (user) await reload(user.role);
      notify(`Invoice ${result.invoice.number} created`);
    } catch (error) { notify(error instanceof Error ? error.message : "Checkout failed"); }
    finally { setBusy(false); }
  }

  function stageVoiceLine(productId: string, quantity: number, destination: VoiceDestination): string {
    const product = products.find((item) => item.id === productId);
    if (!product) return "That catalog item is no longer available. Refresh inventory and try again.";
    if (!Number.isFinite(quantity) || quantity <= 0) return "Enter a quantity greater than zero.";
    const currentLines = destination === "billing" ? lines : quoteLines;
    const existingQuantity = currentLines
      .filter((line) => line.productId === productId)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (existingQuantity + quantity > product.stock) {
      return `Only ${product.stock} ${product.unit} of ${product.name} are in stock. No draft was changed.`;
    }
    const updatedLines = [
      ...currentLines.filter((line) => line.productId !== productId),
      { productId, quantity: existingQuantity + quantity },
    ];
    if (destination === "billing") {
      setLines(updatedLines);
      setTab("billing");
      return `Added ${quantity} ${product.unit} of ${product.name} to the bill draft. Review the invoice and confirm checkout yourself.`;
    }
    setQuoteLines(updatedLines);
    setTab("quotation");
    return `Added ${quantity} ${product.unit} of ${product.name} to the quotation draft. Review it before exporting or pushing it to a bill.`;
  }

  function scanProduct(value: string) {
    const product = products.find((candidate) => candidate.sku.trim().toLowerCase() === value.trim().toLowerCase() || candidate.id === value.trim());
    if (!product) return notify(`No inventory item matches barcode ${value}`);
    const current = lines.find((line) => line.productId === product.id);
    const quantity = (current?.quantity || 0) + 1;
    if (quantity > product.stock) return notify(`${product.name} has no more available stock`);
    setLines(current ? lines.map((line) => line.productId === product.id ? { ...line, quantity } : line) : [...lines, { productId: product.id, quantity }]);
    setTab("billing");
    notify(`${product.name} added to the bill`);
  }

  function updatePayment(invoice: Invoice) {
    const outstanding = Math.max(0, numeric(invoice.grandTotal) - numeric(invoice.amountPaid));
    if (outstanding <= 0) return notify("This invoice is already paid");
    setPaymentInvoice(invoice);
    setPaymentAmount(String(outstanding));
    setRecordPaymentMethod("Cash");
    setCustomPaymentMethod("");
  }

  async function savePayment(event: FormEvent) {
    event.preventDefault();
    if (!paymentInvoice) return;
    const outstanding = Math.max(0, numeric(paymentInvoice.grandTotal) - numeric(paymentInvoice.amountPaid));
    const amount = Number(paymentAmount);
    const method = (recordPaymentMethod === "Custom" ? customPaymentMethod : recordPaymentMethod).trim();
    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) return notify("Enter an amount greater than zero and no more than the balance due");
    if (!method || method.length > 40) return notify("Enter a valid payment method");
    try {
      setBusy(true);
      const result = await api<{ invoice: Invoice }>(`/api/invoices/${paymentInvoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({ amount, paymentMethod: method }),
      });
      setInvoices((current) => current.map((item) => item.id === paymentInvoice.id ? result.invoice : item));
      if (user) await reload(user.role);
      const balance = numeric(result.invoice.grandTotal) - numeric(result.invoice.amountPaid);
      setPaymentInvoice(null);
      notify(`${money(amount)} recorded by ${method}. Balance due: ${money(balance)}`);
      if (company?.paymentNotifications && "Notification" in window && Notification.permission === "granted") {
        new Notification("Customer payment recorded", { body: `${paymentInvoice.customerName} paid ${money(amount)} by ${method}. Remaining: ${money(balance)}.` });
      }
    } catch (error) { notify(error instanceof Error ? error.message : "Payment update failed"); }
    finally { setBusy(false); }
  }

  async function exportAnnual() {
    try {
      const response = await fetch(`/api/admin/gst-annual?year=${new Date().getFullYear()}`);
      if (!response.ok) throw new Error("GST export could not be generated");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `gst-summary-${new Date().getFullYear()}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      notify("Annual GST summary exported. Review it with your tax professional before filing.");
    } catch (error) { notify(error instanceof Error ? error.message : "Export failed"); }
  }

  async function exportLedger() {
    try {
      const response = await fetch("/api/admin/ledger");
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
          ? body.error
          : "Sales ledger export failed";
        throw new Error(message);
      }
      downloadCsvFile("sales-ledger.csv", await response.text());
      notify("Sales ledger exported");
    } catch (error) { notify(error instanceof Error ? error.message : "Sales ledger export failed"); }
  }

  function createQuotation() {
    const items = quoteLines.flatMap((line) => {
      const product = products.find((candidate) => candidate.id === line.productId);
      return product && line.quantity > 0
        ? [{ product, quantity: line.quantity, total: Math.round(product.price * line.quantity * 100) / 100 }]
        : [];
    });
    if (!items.length) return notify("Select at least one item for the quotation");
    const rows = [
      ["SKU", "Item Name", "Quantity", "Base Price", "Stock", "Line Total"],
      ...items.map(({ product, quantity, total }) => [
        product.sku,
        product.name,
        String(quantity),
        product.price.toFixed(2),
        String(product.stock),
        total.toFixed(2),
      ]),
      ["", "", "", "", "Quotation Total", items.reduce((sum, item) => sum + item.total, 0).toFixed(2)],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadCsvFile(`quotation-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    notify("Quotation generated");
  }

  async function exportInvoice(invoice: Invoice) {
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/xlsx`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Invoice export failed");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.number}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { notify(error instanceof Error ? error.message : "Invoice export failed"); }
  }

  async function requestComplianceDocument(invoice: Invoice, endpoint: string, label: string) {
    try {
      const result = await api<{ status: string; irn?: string; qrPayload?: string; providerConfigured?: boolean }>(endpoint, { method: "POST", body: JSON.stringify({ invoiceId: invoice.id }) });
      notify(`${label}: ${result.status}${result.irn ? ` · ${result.irn}` : result.providerConfigured === false ? " · payload ready for authorized provider" : ""}`);
    } catch (error) { notify(error instanceof Error ? error.message : `${label} failed`); }
  }

  async function rotateApiKey() {
    if (!window.confirm("Rotate the tenant integration key? Existing devices using the previous key will stop reporting heartbeats.")) return;
    try {
      const result = await api<{ apiKey: string }>("/api/admin/api-key", { method: "POST" });
      setRotatedKey(result.apiKey);
      notify("New tenant API key created. Copy it now; it will not be shown again.");
    } catch (error) { notify(error instanceof Error ? error.message : "Key rotation failed"); }
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) return notify("Browser notifications are not supported on this device");
    const permission = await Notification.requestPermission();
    notify(permission === "granted" ? "Browser alerts enabled. Business settings control low-stock and payment alerts." : "Browser alerts were not enabled; check your browser permission settings.");
  }

  if (starting) {
    return <main className="login-screen"><div className="w-full max-w-sm space-y-4"><div className="skeleton h-8 w-40" /><div className="skeleton h-52" /></div></main>;
  }
  if (!user || !company) return <Login language={language} onLanguageChange={changeLanguage} onLogin={afterLogin} />;

  const nav: { id: Tab; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean; customerOnly?: boolean; permission?: string }[] = [
    { id: "dashboard", label: t("overview"), icon: LayoutDashboard },
    { id: "billing", label: t("newBill"), icon: ShoppingCart },
    { id: "invoices", label: t("invoices"), icon: Receipt },
    { id: "inventory", label: t("inventory"), icon: Package },
    { id: "quotation", label: "Quotation / Price List", icon: FileText },
    { id: "low-stock", label: t("lowStock"), icon: AlertTriangle },
    { id: "customers", label: t("customers"), icon: Users },
    { id: "payments", label: t("accounting"), icon: CircleDollarSign, adminOnly: true },
    { id: "agent", label: t("agentRequests"), icon: Sparkles },
    { id: "team", label: t("teamAccess"), icon: ShieldCheck, adminOnly: true },
    { id: "settings", label: t("brandSettings"), icon: Settings2, adminOnly: true },
    { id: "compliance", label: t("gstReports"), icon: FileText, adminOnly: true },
    { id: "audit", label: t("auditTrail"), icon: Activity, adminOnly: true },
    { id: "operations", label: "Operations", icon: Package, permission: "inventory.read" },
    { id: "crm", label: "CRM & follow-up", icon: Users, permission: "crm.write" },
    { id: "vendors", label: "Vendors & purchasing", icon: Store, permission: "vendors.write" },
    { id: "warehouses", label: "Warehouses & transfers", icon: Package, permission: "inventory.read" },
    { id: "pump-simulator", label: "Pump head & stages", icon: Activity, permission: "inventory.read" },
    { id: "expenses", label: "Expenses", icon: CircleDollarSign, permission: "expenses.write" },
    { id: "reports", label: "Financial reports", icon: BarChart3, adminOnly: true, permission: "reports.read" },
    { id: "cash-flow", label: "Cash flow forecast", icon: BarChart3, adminOnly: true, permission: "reports.read" },
    { id: "notifications", label: "Notifications", icon: MessageCircle },
    { id: "regional", label: "Regional settings", icon: Settings2, adminOnly: true, permission: "settings.write" },
    { id: "security", label: "Permissions & security", icon: ShieldCheck, adminOnly: true, permission: "security.audit" },
    { id: "module-portfolio", label: "Module portfolio", icon: Package, adminOnly: true, permission: "security.audit" },
    { id: "diagnostics", label: "Runtime diagnostics", icon: Activity, adminOnly: true, permission: "security.audit" },
    { id: "backups", label: "Backups & recovery", icon: Download, adminOnly: true, permission: "backups.write" },
    { id: "integrations", label: "Integrations", icon: Store, adminOnly: true, permission: "integrations.write" },
    { id: "templates", label: "Template gallery", icon: FileText, permission: "template.cloud" },
    { id: "sales", label: "Sales workspace", icon: ShoppingCart, permission: "billing.write" },
    { id: "pricing", label: "Pricing & rate cards", icon: CircleDollarSign, permission: "inventory.read" },
    { id: "notes", label: "Credit / debit notes", icon: FileText, permission: "billing.write" },
    { id: "ledger", label: "Party ledger / Khata", icon: BarChart3, permission: "reports.read" },
    { id: "portal", label: "Customer portal", icon: Receipt, customerOnly: true },
  ];
  const subscriptionRestricted = subscription?.expired === true;
  const subscriptionAllows = (item: { id: Tab }) => !subscription || item.id === "templates" ? !subscription || subscription.features.cloudTemplates : item.id === "compliance" || item.id === "integrations" ? !subscription || subscription.features.compliance || subscription.features.integrations : true;
  const allowedNav = user.role === "CUSTOMER"
    ? nav.filter((item) => item.customerOnly)
    : nav.filter((item) => !item.customerOnly && (!item.adminOnly || user.role === "ADMIN") && (!item.permission || !user.permissions || user.permissions.includes(item.permission)) && (!subscriptionRestricted || !["billing", "templates", "compliance", "integrations"].includes(item.id)) && subscriptionAllows(item));

  return (
    <div className={`app-shell app-theme-${appTheme} theme-${company.theme || "luxe"}`}>
      <div className="app-layout">
        <aside className="sidebar no-print">
          <div className="flex items-center gap-3 px-2">
            <div className="brand-mark"><Receipt size={20} /></div>
            <div className="min-w-0"><p className="truncate font-bold">{company.name || "Namma Bill"}</p><p className="muted text-xs">{t("workspace")}</p></div>
          </div>
          <div className="mt-9">
            <p className="eyebrow px-3 pb-2">{t("workspace")}</p>
            <nav className="space-y-1">
              {allowedNav.map((item) => <button key={item.id} className="sidebar-link w-full" data-active={tab === item.id} onClick={() => setTab(item.id)} data-resilient-action>
                <item.icon size={18} /><span>{item.label}</span>{tab === item.id && <ChevronRight className="ml-auto" size={15} />}
              </button>)}
            </nav>
          </div>
          <div className="panel absolute bottom-5 left-4 right-4 p-3">
            <div className="flex items-center gap-2"><div className="brand-mark !h-8 !w-8 !rounded-xl"><Sparkles size={15} /></div><div className="min-w-0"><p className="truncate text-sm font-bold">{user.displayName}</p><p className="muted text-xs">{user.role === "ADMIN" ? t("adminRole") : user.role === "CUSTOMER" ? "Customer" : "Sales"}</p></div></div>
            <button className="button button-quiet mt-2 w-full !justify-start !px-2 !py-2 text-sm" onClick={logout}><LogOut size={15} /> {t("signOut")}</button>
          </div>
        </aside>

        <div className="main-column">
          <header className="topbar no-print">
            {subscription && subscription.planCode !== "FULL" && <button className={`subscription-banner ${subscription.expired ? "subscription-expired" : ""}`} onClick={() => setUpgradeOpen(true)}><span><strong>{subscription.expired ? "Trial expired" : subscription.daysRemaining === null ? "Demo mode" : `${subscription.planCode === "DEMO" ? "Demo mode" : "Trial mode"} · ${subscription.daysRemaining} days left`}</strong><span className="hidden sm:inline"> · {subscription.limits.invoicesPerMonth} invoices/month · {subscription.limits.products} products</span></span><span className="font-bold">Upgrade to Full Access</span></button>}
            <div className="flex min-w-0 items-center gap-3">
              <div className="brand-mark !h-9 !w-9 lg:hidden"><Receipt size={17} /></div>
              <div className="min-w-0"><p className="eyebrow">CHINNATHAMBI TRADERS · Admin Panel</p><h1 className="truncate text-lg font-bold">{tab === "product" ? t("inventoryTitle") : allowedNav.find((item) => item.id === tab)?.label || t("businessPulse")}</h1></div>
            </div>
            <div className="flex items-center gap-2">
              {user.role !== "CUSTOMER" && <div className="relative hidden w-64 xl:block">
                <Search className="muted absolute left-3 top-1/2 -translate-y-1/2" size={16} />
                <input className="field !py-2 pl-10 text-sm" aria-label="Global search" placeholder="Search bills, customers, inventory..." value={search} onChange={(event) => setSearch(event.target.value)} />
                {search.trim() && <div className="panel absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-auto p-1" role="listbox">
                  {globalSearchResults.length ? globalSearchResults.map((result) => <button key={`${result.tab}-${result.id}`} className="flex w-full items-start gap-2 rounded-lg p-2 text-left text-sm hover:bg-[var(--accent-soft)]" onClick={() => { setTab(result.tab); setSearch(""); }} role="option"><Search size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" /><span><span className="block font-semibold">{result.title}</span><span className="muted text-xs">{result.detail}</span></span></button>) : <p className="muted p-3 text-sm">No matching records</p>}
                </div>}
              </div>}
              <LanguagePicker language={language} onChange={changeLanguage} />
              <span className={`tag hidden sm:inline-flex ${isOnline ? "tag-paid" : "tag-partial"}`} role="status" aria-live="polite" title={isOnline ? "Connected; server validates all changes" : "Offline; invoice and stock changes require a connection"}>
                {isOnline ? <Wifi size={13} className="mr-1" /> : <WifiOff size={13} className="mr-1" />}{isOnline ? "Online" : "Offline · writes paused"}
              </span>
              {dashboard?.lowStock.length ? <span className="tag hidden !bg-amber-50 !text-amber-700 sm:inline-flex"><AlertTriangle size={13} className="mr-1" /> {dashboard.lowStock.length} {t("lowStockAlert")}</span> : <span className="tag tag-paid hidden sm:inline-flex"><Activity size={13} className="mr-1" /> {t("allSystemsReady")}</span>}
              {user.role !== "CUSTOMER" && <button className="button button-quiet !px-2" onClick={() => void reload(user.role)} aria-label="Refresh workspace" data-resilient-action data-safe-fallback="refresh-workspace"><RotateCcw size={16} /></button>}
              <details className="relative">
                <summary className="button button-soft cursor-pointer list-none !px-3 !py-2 text-sm" aria-label="Open profile and theme settings">
                  {user.avatarData ? <img src={user.avatarData} alt="" className="h-5 w-5 rounded-full object-cover" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">{user.displayName.slice(0, 1).toUpperCase()}</span>}<span className="hidden max-w-28 truncate sm:inline">{user.displayName}</span><span className="sm:hidden"><Settings2 size={16} /></span><ChevronRight size={14} className="rotate-90" />
                </summary>
                <div className="panel absolute right-0 top-full z-30 mt-2 w-72 p-4">
                  <div className="flex items-center gap-2"><div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-[var(--accent)] text-sm font-bold text-white">{user.avatarData ? <img src={user.avatarData} alt="" className="h-full w-full object-cover" /> : user.displayName.slice(0, 1).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm font-bold">{user.displayName}</p><p className="muted mt-1 text-xs">{user.username} · {user.role === "ADMIN" ? t("adminRole") : user.role === "CUSTOMER" ? "Customer" : "Sales"}</p></div></div>
                  {profileEditing ? <div className="mt-3 space-y-2"><label className="block text-xs font-semibold" htmlFor="inline-profile-name">Display name</label><input id="inline-profile-name" className="field !py-2 text-sm" value={profileName} onChange={(event) => setProfileName(event.target.value)} /><label className="block text-xs font-semibold" htmlFor="inline-profile-avatar">Avatar</label><input id="inline-profile-avatar" className="field !py-2 text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file || file.size > 500_000) return notify("Avatar must be under 500 KB"); const reader = new FileReader(); reader.onload = () => setProfileAvatar(typeof reader.result === "string" ? reader.result : ""); reader.readAsDataURL(file); }} /><div className="flex gap-2"><button className="button button-primary flex-1 !py-2 text-xs" onClick={() => void saveInlineProfile()}>Save profile</button><button className="button button-quiet flex-1 !py-2 text-xs" onClick={() => setProfileEditing(false)}>Cancel</button></div></div> : <button className="button button-quiet mt-3 w-full !justify-start !px-2 !py-2 text-xs" onClick={() => setProfileEditing(true)}>Edit profile inline</button>}
                  {businesses.length > 1 && <div className="mt-4 border-t border-[var(--line)] pt-3"><p className="eyebrow">Business books</p><div className="mt-2 space-y-1">{businesses.map((business) => <button key={business.tenantId} className="flex w-full items-center justify-between rounded-lg p-2 text-left text-sm hover:bg-[var(--accent-soft)]" onClick={() => business.active ? undefined : void switchBusiness(business.tenantId)}><span className="truncate">{business.name}</span>{business.active && <Check size={14} className="text-[var(--accent)]" />}</button>)}</div></div>}
                  <label className="mt-4 block text-xs font-semibold" htmlFor="appearance-theme">Appearance theme</label>
                  <select id="appearance-theme" className="field mt-1 !py-2 text-sm" value={appTheme} onChange={(event) => void saveAppearanceTheme(event.target.value as AppThemeName)}>
                    {Object.entries(appearanceThemes).map(([key, theme]) => <option value={key} key={key}>{theme.label}</option>)}
                  </select>
                  <button className="button button-quiet mt-3 w-full !justify-start !px-2 !py-2 text-sm" onClick={() => void logout()}><LogOut size={15} /> {t("signOut")}</button>
                </div>
              </details>
            </div>
          </header>

          <main className="content">
            <AnimatePresence mode="wait">
              <motion.div key={tab} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .18 }}>
                {tab === "dashboard" && <DashboardView language={language} user={user} dashboard={dashboard} invoices={invoices} pendingInvoices={pendingInvoices} onTab={setTab} onPreview={setPreview} onPayment={updatePayment} />}
                {tab === "portal" && user.role === "CUSTOMER" && <CustomerPortalView onPreview={setPreview} />}
                {tab === "billing" && <BillingView language={language}
                  products={products} customers={customers} company={company} lines={lines} setLines={setLines}
                  customerId={customerId} setCustomerId={setCustomerId} placeOfSupplyStateCode={placeOfSupplyStateCode}
                  setPlaceOfSupplyStateCode={setPlaceOfSupplyStateCode} discount={discount} setDiscount={setDiscount}
                  amountPaid={amountPaid} setAmountPaid={setAmountPaid} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
                  customCheckoutMethod={customCheckoutMethod} setCustomCheckoutMethod={setCustomCheckoutMethod}
                  totals={billTotals} busy={busy} canCreateInvoice={!subscription?.expired && subscription?.features.invoiceCreate !== false} onBarcodeScan={scanProduct} onCheckout={checkout} onNewCustomer={() => setCustomerModal(true)}
                  onNewProduct={() => startProductCreate("billing")} user={user} />
                }
                {tab === "invoices" && <InvoiceHistoryView invoices={visibleInvoices} search={search} setSearch={setSearch} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} onPreview={setPreview} onPayment={updatePayment} />}
                {tab === "inventory" && <InventoryView language={language} products={products} canManage={user.role === "ADMIN"} onAdd={() => startProductCreate("inventory")} onEdit={(product) => editProduct(product, "inventory")} onDelete={deleteProduct} search={search} setSearch={setSearch} />}
                {tab === "quotation" && <QuotationView products={products} lines={quoteLines} onChange={setQuoteLines} canManage={user.role === "ADMIN"} onAddItem={() => startProductCreate("quotation")} onCreateQuotation={createQuotation} onPushToBill={() => { setLines(quoteLines); setTab("billing"); }} />}
                {tab === "product" && user.role === "ADMIN" && <ProductEditorView product={newProduct} setProduct={setNewProduct} editing={Boolean(editingProductId)} busy={busy} onSave={saveProduct} onCancel={() => { setEditingProductId(null); setTab(productReturnTab); }} />}
                {tab === "low-stock" && <LowStockView language={language} products={dashboard?.lowStock || []} canManage={user.role === "ADMIN"} onInventory={() => setTab("inventory")} onEdit={(product) => editProduct(product, "low-stock")} />}
                {tab === "customers" && <CustomersView language={language} customers={customers} balances={customerBalances} canViewFinancials={user.role === "ADMIN"} onAdd={() => { setEditingCustomerId(null); setNewCustomer({ name: "", phone: "", email: "", gstin: "", state: "", stateCode: "33", address: "" }); setCustomerModal(true); }} onEdit={editCustomer} onDelete={deleteCustomer} onPayments={() => setTab("payments")} search={search} setSearch={setSearch} />}
                {tab === "payments" && user.role === "ADMIN" && <PaymentsView language={language} pendingInvoices={pendingInvoices} completedInvoices={completedInvoices} recentPayments={recentPayments} paymentSummary={paymentSummary} customers={customers} onPayment={updatePayment} onPreview={setPreview} onBilling={() => setTab("billing")} />}
                {tab === "agent" && <AgentWorkbenchView language={language} isAdmin={user.role === "ADMIN"} products={products} onStageLine={stageVoiceLine} />}
                {tab === "team" && user.role === "ADMIN" && <TeamView users={users} onAdd={() => setUserModal(true)} onRemove={removeUser} />}
                {tab === "settings" && user.role === "ADMIN" && <SettingsView company={company} setCompany={setCompany} busy={busy} onSave={saveCompany} onVerify={verifyGstin} onRotateKey={rotateApiKey} onEnableNotifications={enableBrowserNotifications} />}
                {tab === "compliance" && user.role === "ADMIN" && <ComplianceView invoices={invoices} onExport={exportAnnual} onExportLedger={exportLedger} />}
                {tab === "audit" && user.role === "ADMIN" && <AuditView entries={auditEntries} users={users} />}
                {tab === "operations" && <DynamicModuleWorkbenchView title="Inventory & billing operations" description="Locked stock adjustments, SKU variations, recurring schedules, milestones, and quotation conversion." endpoint="/api/billing/milestones" actionLabel="Refresh operations" />}
                {tab === "crm" && <DynamicModuleWorkbenchView title="Customer relationship management" description="Interaction history, reminders, follow-ups, and customer portal workflows." endpoint="/api/crm/interactions" actionLabel="Refresh CRM" />}
                {tab === "vendors" && <DynamicModuleWorkbenchView title="Supplier & vendor management" description="Vendor directory, purchase orders, goods receipts, and stock replenishment." endpoint="/api/vendors" actionLabel="Refresh vendors" />}
                {tab === "warehouses" && <DynamicWarehouseTransferView canManage={user.permissions?.includes("inventory.write") === true || user.role === "ADMIN"} />}
                {tab === "pump-simulator" && <DynamicPumpHeadSimulator />}
                {tab === "expenses" && (user.role === "ADMIN" || user.permissions?.includes("expenses.write")) && <DynamicModuleWorkbenchView title="Expense tracking" description="Categorized expenses with encrypted receipts and per-document access grants." endpoint="/api/expenses" actionLabel="Refresh expenses" canReadDocuments={user.role === "ADMIN" || user.permissions?.includes("documents.read") === true} canManageDocuments={user.role === "ADMIN"} />}
                {tab === "reports" && user.role === "ADMIN" && <DynamicModuleWorkbenchView title="Financial reporting" description="Profit and loss, cash flow, receivables, inventory valuation, and tax-ready summaries." endpoint="/api/reports/financial" actionLabel="Refresh reports" />}
                {tab === "cash-flow" && user.role === "ADMIN" && <DynamicCashFlowForecastView />}
                {tab === "notifications" && <DynamicModuleWorkbenchView title="Notifications & alerts" description="In-app, email, SMS, and push-ready notification records for stock, payments, and documents." endpoint="/api/notifications" actionLabel="Refresh alerts" />}
                {tab === "regional" && user.role === "ADMIN" && <DynamicModuleWorkbenchView title="Multi-currency & regional settings" description="Base currency, locale, timezone, tax jurisdiction, and exchange-rate controls." endpoint="/api/settings/regional" actionLabel="Refresh regional settings" />}
                {tab === "security" && user.role === "ADMIN" && <DynamicModuleWorkbenchView title="Permissions & security audit" description="Granular grants, immutable audit history, session controls, and access reviews." endpoint="/api/admin/permissions" actionLabel="Refresh permissions" />}
                {tab === "module-portfolio" && user.role === "ADMIN" && <DynamicModulePortfolioView />}
                {tab === "diagnostics" && user.role === "ADMIN" && <DynamicAdminDiagnosticsView />}
                {tab === "backups" && user.role === "ADMIN" && <DynamicModuleWorkbenchView title="Data backup & recovery" description="Integrity-checked tenant snapshots with explicit, financial-document-safe recovery." endpoint="/api/admin/backups" actionLabel="Create backup" actionEndpoint="/api/admin/backups" />}
                {tab === "integrations" && user.role === "ADMIN" && <DynamicModuleWorkbenchView title="API integration gateway" description="HTTPS-only, rate-limited provider connections for payment, shipping, and accounting systems." endpoint="/api/admin/integrations" actionLabel="Refresh integrations" />}
                {tab === "templates" && <TemplateGalleryView />}
                {tab === "sales" && <DynamicModuleWorkbenchView title="Sales workspace" description="Unified sales orders, invoices, quotations, delivery documents, and standardized document actions." endpoint="/api/sales-documents" actionLabel="Refresh sales" />}
                {tab === "pricing" && <DynamicModuleWorkbenchView title="Pricing & rate cards" description="Wholesale, retail, MRP, distributor slabs, customer-specific prices, discounts, and margin controls." endpoint="/api/pricing/rate-cards" actionLabel="Refresh rate cards" />}
                {tab === "notes" && <DynamicModuleWorkbenchView title="Credit / debit notes & returns" description="Invoice-linked adjustments, sales returns, warehouse restocking, and reversed tax liability." endpoint="/api/notes" actionLabel="Refresh notes" />}
                {tab === "ledger" && <DynamicModuleWorkbenchView title="Party ledger / Khata" description="Receivables, payables, aging buckets, payment reminders, and UPI-linked follow-up actions." endpoint="/api/ledger/party?partyType=CUSTOMER" actionLabel="Refresh ledger" />}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <nav className="mobile-nav no-print">
        {allowedNav.map((item) => <button key={item.id} data-active={tab === item.id} onClick={() => setTab(item.id)}><item.icon size={18} /><span>{item.label}</span></button>)}
      </nav>
      {toast && <motion.div className="toast" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} role="status">{toast}</motion.div>}
      {upgradeOpen && <Modal title="Upgrade to Full Access" onClose={() => setUpgradeOpen(false)}><p className="muted text-sm">Unlock cloud templates, compliance exports, integrations, 100,000 products, 100,000 monthly invoices, and up to 1,000 users for this business book.</p><div className="mt-4 rounded-xl bg-[var(--accent-soft)] p-4 text-sm"><p className="font-semibold">Current plan: {subscription?.planCode || "Demo"}</p><p className="muted mt-1">Upgrade applies to the active business only. Existing invoices and customers remain unchanged.</p></div><div className="mt-5 flex justify-end gap-2"><button className="button button-quiet" onClick={() => setUpgradeOpen(false)}>Not now</button><button className="button button-primary" onClick={() => void upgradeToFullAccess()}>Enable Full Access</button></div></Modal>}
      {rotatedKey && <Modal title="Copy your new tenant API key" onClose={() => setRotatedKey("")}>
        <p className="muted text-sm">This key is shown once. Save it in your secure device or deployment secret store.</p>
        <code className="mt-4 block break-all rounded-xl bg-slate-950 p-4 text-sm text-emerald-200">{rotatedKey}</code>
        <div className="mt-4 flex justify-end gap-2"><button className="button button-soft" onClick={() => void navigator.clipboard.writeText(rotatedKey).then(() => notify("API key copied")).catch(() => notify("Clipboard unavailable; select and copy the key manually"))}>Copy key</button><button className="button button-primary" onClick={() => setRotatedKey("")}>Done</button></div>
      </Modal>}
      {preview && <InvoicePreview invoice={preview} company={company} customers={customers} onClose={() => setPreview(null)} onExport={exportInvoice} onEInvoice={(invoice) => void requestComplianceDocument(invoice, "/api/admin/compliance/einvoice", "E-invoice") } onEWay={setEwayInvoice} />}
      {ewayInvoice && <EWayBillDialog invoice={ewayInvoice} onClose={() => setEwayInvoice(null)} notify={notify} />}
      {paymentInvoice && <Modal title={`Record payment · ${paymentInvoice.number}`} onClose={() => setPaymentInvoice(null)}>
        <form className="space-y-4" onSubmit={savePayment}>
          <p className="muted text-sm">{paymentInvoice.customerName} · Balance due {money(numeric(paymentInvoice.grandTotal) - numeric(paymentInvoice.amountPaid))}</p>
          <Field label="Amount received (₹)"><input className="field" type="number" min=".01" step=".01" max={numeric(paymentInvoice.grandTotal) - numeric(paymentInvoice.amountPaid)} required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></Field>
          <Field label="Payment method"><select className="field" value={recordPaymentMethod} onChange={(event) => setRecordPaymentMethod(event.target.value)}><option>Cash</option><option>UPI</option><option>Bank transfer</option><option>Card</option><option>Hand / manual</option><option>Custom</option></select></Field>
          {recordPaymentMethod === "Custom" && <Field label="Custom method name"><input className="field" required maxLength={40} value={customPaymentMethod} onChange={(event) => setCustomPaymentMethod(event.target.value)} placeholder="Enter payment method" /></Field>}
          <div className="flex justify-end gap-2"><button type="button" className="button button-quiet" onClick={() => setPaymentInvoice(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Save payment</button></div>
        </form>
      </Modal>}
      {customerModal && <Modal title={editingCustomerId ? "Edit customer" : "Add customer"} onClose={() => { setCustomerModal(false); setEditingCustomerId(null); }}>
        <form className="space-y-4" onSubmit={saveCustomer}>
          <div className="form-grid">
            <Field label="Customer name"><input className="field" required value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} /></Field>
            <Field label="Phone"><input className="field" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="field" type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></Field>
            <Field label="GSTIN"><input className="field" maxLength={15} value={newCustomer.gstin} onChange={(e) => setNewCustomer({ ...newCustomer, gstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="State"><input className="field" value={newCustomer.state} onChange={(e) => setNewCustomer({ ...newCustomer, state: e.target.value })} /></Field>
            <Field label="State code"><StateSelect value={newCustomer.stateCode} onChange={(value) => setNewCustomer({ ...newCustomer, stateCode: value })} /></Field>
          </div>
          <Field label="Billing address"><input className="field" value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><button type="button" className="button button-quiet" onClick={() => setCustomerModal(false)}>Cancel</button><button className="button button-primary" disabled={busy} data-resilient-action><Plus size={16} /> Save customer</button></div>
        </form>
      </Modal>}
      {userModal && <Modal title="Create team account" onClose={() => setUserModal(false)}>
        <form className="space-y-4" onSubmit={saveUser}>
          <div className="form-grid">
            <Field label="Display name"><input className="field" required value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} /></Field>
            <Field label="Username"><input className="field" required minLength={3} value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} /></Field>
            <Field label="Temporary password (12+ characters)"><input className="field" type="password" required minLength={12} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></Field>
            <Field label="Role"><select className="field" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as Role, customerId: e.target.value === "CUSTOMER" ? newUser.customerId : "" })}><option value="SALES">Sales · POS and customer workflows</option><option value="CUSTOMER">Customer · portal only</option><option value="ADMIN">Administrator</option></select></Field>
            {newUser.role === "CUSTOMER" && <Field label="Linked customer"><select className="field" required value={newUser.customerId} onChange={(e) => setNewUser({ ...newUser, customerId: e.target.value })}><option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>}
          </div>
          <div className="flex justify-end gap-2"><button type="button" className="button button-quiet" onClick={() => setUserModal(false)}>Cancel</button><button className="button button-primary" disabled={busy} data-resilient-action><Plus size={16} /> Create account</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop no-print" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section className="panel modal-card" initial={{ opacity: 0, y: 12, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
      <header className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button className="button button-quiet !p-2" onClick={onClose} aria-label="Close"><X size={17} /></button></header>
      {children}
    </motion.section>
  </div>;
}

function DashboardView({ language, user, dashboard, invoices, pendingInvoices, onTab, onPreview, onPayment }: {
  language: Language; user: User; dashboard: Dashboard | null; invoices: Invoice[]; pendingInvoices: Invoice[]; onTab: (tab: Tab) => void;
  onPreview: (invoice: Invoice) => void; onPayment: (invoice: Invoice) => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const summary = dashboard?.summary;
  const lowStock = dashboard?.lowStock || [];
  const latest = invoices.slice(0, 6);
  return <section className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">{t("businessPulse")}</p><h2 className="mt-2 text-3xl font-bold">{t("dashboardGreeting")}, {user.displayName.split(" ")[0]}</h2><p className="muted mt-1">{t("dashboardSubtitle")}</p></div>
      <button className="button button-primary" onClick={() => onTab("billing")} data-resilient-action><Plus size={17} /> {t("createNewBill")}</button>
    </div>
    <div className="metric-grid dashboard-metric-grid">
      <Metric icon={CircleDollarSign} label={user.role === "ADMIN" ? t("grossSalesToday") : t("invoicesToday")} value={user.role === "ADMIN" ? money(summary?.salesToday) : String(summary?.invoiceCountToday ?? 0)} note={user.role === "ADMIN" ? t("invoices") : t("allInvoices")} onClick={() => onTab("invoices")} />
      <Metric icon={Receipt} label={user.role === "ADMIN" ? t("allInvoices") : t("invoices")} value={String(summary?.invoiceCount ?? invoices.length)} note={t("invoices")} onClick={() => onTab("invoices")} />
      <Metric icon={Package} label={t("catalogItems")} value={String(dashboard?.inventory.length ?? 0)} note={`${lowStock.length} · ${t("lowStock")}`} onClick={() => onTab("inventory")} />
      {user.role === "ADMIN" ? <Metric icon={BarChart3} label={t("inventoryValue")} value={money(summary?.inventoryValue)} note={t("stockValue")} onClick={() => onTab("inventory")} /> : <Metric icon={Users} label={t("customerDirectory")} value={String(dashboard?.customers ?? 0)} note={t("customers")} onClick={() => onTab("customers")} />}
      {user.role === "ADMIN" && <Metric icon={CircleDollarSign} label={t("pendingPayments")} value={money(pendingInvoices.reduce((sum, invoice) => sum + numeric(invoice.grandTotal) - numeric(invoice.amountPaid), 0))} note={t("accounting")} onClick={() => onTab("payments")} />}
    </div>
    {lowStock.length > 0 && <section className="panel content-card border-amber-200/70">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={18} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{t("lowStockWatch")}</h3><button className="button button-soft !px-3 !py-2 text-xs" onClick={() => onTab("low-stock")}>{t("viewLowStock")} <ChevronRight size={14} /></button></div><p className="muted mt-1 text-sm">{t("lowStockHint")}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">{lowStock.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl bg-amber-50/70 px-3 py-2.5 text-sm">
        <div className="min-w-0"><p className="truncate font-semibold">{item.name}</p><p className="muted text-xs">Available {item.stock} · alert at {item.lowStockAt}</p>{user.role === "ADMIN" && <p className="muted text-xs">Unit {money(item.price)}</p>}</div>{user.role === "ADMIN" && <div className="shrink-0 text-right"><p className="font-semibold">{money(item.price * item.stock)}</p><p className="muted text-xs">stock value</p></div>}
        </div>)}</div>
      </div></div>
    </section>}
    <div className="workspace-grid">
      <section className="panel content-card">
        <div className="mb-4 flex items-center justify-between gap-3"><div><p className="eyebrow">{t("recentActivity")}</p><h3 className="mt-1 text-lg font-bold">{t("latestInvoices")}</h3></div><button className="button button-soft !px-3 !py-2 text-sm" onClick={() => onTab(user.role === "ADMIN" ? "compliance" : "invoices")}>{user.role === "ADMIN" ? t("viewReports") : t("invoices")} <ChevronRight size={15} /></button></div>
        <InvoiceTable invoices={latest} onPreview={onPreview} onPayment={onPayment} allowPayment={true} />
      </section>
      <section className="panel content-card">
        <p className="eyebrow">{t("quickActions")}</p><h3 className="mt-1 text-lg font-bold">{t("quickActions")}</h3>
        <div className="mt-4 space-y-2">
          <QuickAction icon={ShoppingCart} title={t("startCheckout")} detail={t("createGstInvoice")} onClick={() => onTab("billing")} />
          <QuickAction icon={Package} title={t("browseInventory")} detail={t("inventoryHint")} onClick={() => onTab("inventory")} />
          {user.role === "ADMIN" && <QuickAction icon={CircleDollarSign} title={t("pendingPayments")} detail={t("accountingHint")} onClick={() => onTab("payments")} />}
          <QuickAction icon={FileText} title={t("gstSummary")} detail={t("gstReports")} onClick={() => onTab(user.role === "ADMIN" ? "compliance" : "billing")} />
        </div>
        <div className="mt-5 rounded-xl bg-[var(--accent-soft)] p-3.5 text-sm text-[var(--accent)]"><div className="flex items-center gap-2 font-bold"><Sparkles size={16} /> Secure by design</div><p className="mt-1 opacity-80">Your records are stored in your business’s isolated database schema.</p></div>
      </section>
    </div>
  </section>;
}

function Metric({ icon: Icon, label, value, note, onClick }: { icon: typeof CircleDollarSign; label: string; value: string; note: string; onClick?: () => void }) {
  const content = <>
    <div className="flex items-center justify-between"><span className="eyebrow">{label}</span><span className="rounded-xl bg-[var(--accent-soft)] p-2 text-[var(--accent)]"><Icon size={17} /></span></div>
    <p className="mt-4 truncate text-2xl font-bold tracking-tight">{value}</p><p className="muted mt-1 text-xs">{note}</p>
  </>;
  return onClick
    ? <motion.button type="button" className="panel metric-card w-full cursor-pointer text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" whileHover={{ y: -2 }} onClick={onClick} aria-label={`${label}: ${value}. ${note}`}>
      {content}
    </motion.button>
    : <motion.div className="panel metric-card" whileHover={{ y: -2 }}>{content}</motion.div>;
}

function QuickAction({ icon: Icon, title, detail, onClick }: { icon: typeof ShoppingCart; title: string; detail: string; onClick: () => void }) {
  return <button className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-[var(--accent-soft)]" onClick={onClick}>
    <span className="rounded-xl bg-[var(--accent-soft)] p-2 text-[var(--accent)]"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="muted block truncate text-xs">{detail}</span></span><ChevronRight size={16} className="muted" />
  </button>;
}

function BillingView({ language, products, customers, company, lines, setLines, customerId, setCustomerId, placeOfSupplyStateCode,
  setPlaceOfSupplyStateCode, discount, setDiscount, amountPaid, setAmountPaid, paymentMethod, setPaymentMethod,
  customCheckoutMethod, setCustomCheckoutMethod,
  totals, busy, onCheckout, onNewCustomer, onNewProduct, user }: {
  language: Language; products: Product[]; customers: Customer[]; company: Company; lines: BillLine[]; setLines: (lines: BillLine[]) => void;
  customerId: string; setCustomerId: (id: string) => void; placeOfSupplyStateCode: string;
  setPlaceOfSupplyStateCode: (code: string) => void; discount: string; setDiscount: (value: string) => void;
  amountPaid: string; setAmountPaid: (value: string) => void; paymentMethod: string; setPaymentMethod: (value: string) => void;
  customCheckoutMethod: string; setCustomCheckoutMethod: (value: string) => void;
  totals: { items: { product: Product; quantity: number; gross: number }[]; subtotal: number; discount: number; taxable: number; tax: number; grandTotal: number; roundOff: number };
  busy: boolean; canCreateInvoice: boolean; onBarcodeScan: (value: string) => void; onCheckout: (event: FormEvent) => void; onNewCustomer: () => void; onNewProduct: () => void; user: User;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const methods = ["Cash", "UPI", "Hand / manual", "Card", "Bank transfer", "Credit", "Custom"];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">{t("pointOfSale")}</p><h2 className="mt-1 text-2xl font-bold">{t("createGstInvoice")}</h2><p className="muted mt-1 text-sm">{t("taxHint")}</p></div><span className="tag"><Store size={13} className="mr-1" /> {company.legalName}</span></div>
    <form className="workspace-grid items-start" onSubmit={onCheckout}>
      <section className="panel content-card">
        <div className="flex items-center justify-between"><h3 className="font-bold">{t("customerItems")}</h3><button type="button" className="button button-soft !px-3 !py-2 text-sm" onClick={onNewCustomer}><Plus size={14} /> {t("newCustomer")}</button></div>
        <div className="mt-4"><BarcodeScanner onScan={onBarcodeScan} /></div>
        <div className="form-grid mt-4">
          <Field label={t("customer")}><select className="field" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">{t("walkInCustomer")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.gstin ? ` · ${customer.gstin}` : ""}</option>)}</select></Field>
          <Field label={t("placeOfSupply")}><StateSelect value={placeOfSupplyStateCode} onChange={setPlaceOfSupplyStateCode} /></Field>
        </div>
        <div className="mt-6 flex items-center justify-between"><h3 className="font-bold">{t("lineItems")}</h3>{user.role === "ADMIN" && <button type="button" className="button button-quiet !px-2 !py-1 text-sm" onClick={onNewProduct}><Plus size={14} /> {t("addInventoryItem")}</button>}</div>
        {products.length === 0 ? <div className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{user.role === "ADMIN" ? "Add an inventory item before checkout." : "No inventory items are available. Ask an administrator to add items."}</div> :
          <div className="mt-3 space-y-2">
            {lines.map((line, index) => {
              const product = products.find((item) => item.id === line.productId);
              return <div key={`${index}-${line.productId}`} className="grid grid-cols-1 items-end gap-2 rounded-xl bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_86px_95px_38px]">
                <ProductPicker products={products} value={line.productId} onChange={(productId) => setLines(lines.map((item, i) => i === index ? { ...item, productId } : item))} />
                <Field label={t("quantity")}><input className="field !py-2" type="number" min=".001" step=".001" max={product?.stock} value={line.quantity} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) } : item))} /></Field>
                <div className="pb-2 text-right text-sm font-semibold">{money((product?.price || 0) * line.quantity)}</div>
                <button type="button" className="button button-quiet !p-2 text-rose-500" aria-label="Remove item" onClick={() => setLines(lines.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
              </div>;
            })}
              <button type="button" className="button button-soft w-full border border-dashed border-[var(--accent)]/25" onClick={() => setLines([...lines, { productId: products[0].id, quantity: 1 }])}><Plus size={16} /> {t("addLine")}</button>
          </div>}
        <div className="form-grid mt-5">
            <Field label={t("discount")}><input className="field" type="number" min="0" max={totals.subtotal} step=".01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
            <Field label={t("amountReceived")}><input className="field" type="number" min="0" max={totals.grandTotal} step=".01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0.00" /></Field>
            <Field label={t("paymentMethod")}><select className="field" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{methods.map((method) => <option key={method}>{method}</option>)}</select></Field>
            {paymentMethod === "Custom" && <Field label={t("customMethod")}><input className="field" required maxLength={40} value={customCheckoutMethod} onChange={(e) => setCustomCheckoutMethod(e.target.value)} placeholder={t("customMethod")} /></Field>}
        </div>
      </section>
      <section className="panel content-card sticky top-5">
          <p className="eyebrow">{t("invoicePreview")}</p><h3 className="mt-1 text-lg font-bold">{t("billSummary")}</h3>
        <div className="mt-5 space-y-3 text-sm">
            <p className="flex justify-between"><span className="muted">{t("lineItems")}</span><span>{totals.items.length}</span></p>
            <p className="flex justify-between"><span className="muted">{t("subtotal")}</span><span>{money(totals.subtotal)}</span></p>
            <p className="flex justify-between"><span className="muted">{t("discount").split(" (")[0]}</span><span>− {money(totals.discount)}</span></p>
            <p className="flex justify-between"><span className="muted">{t("taxableAmount")}</span><span>{money(totals.taxable)}</span></p>
            <p className="flex justify-between"><span className="muted">{company.stateCode === placeOfSupplyStateCode ? t("cgstSgst") : t("igst")}</span><span>{money(totals.tax)}</span></p>
            <p className="flex justify-between"><span className="muted">{t("roundOff")}</span><span>{money(totals.roundOff)}</span></p>
            <p className="flex justify-between border-t border-[var(--line)] pt-4 text-lg font-bold"><span>{t("total")}</span><span>{money(totals.grandTotal)}</span></p>
            <p className="flex justify-between text-xs"><span className="muted">{t("paymentStatus")}</span><span className={`tag tag-${Number(amountPaid) >= totals.grandTotal ? "paid" : Number(amountPaid) > 0 ? "partial" : "unpaid"}`}>{Number(amountPaid) >= totals.grandTotal && totals.grandTotal > 0 ? t("paid") : Number(amountPaid) > 0 ? t("partial") : t("unpaidCredit")}</span></p>
        </div>
          <button className="button button-primary mt-6 w-full" disabled={busy || !totals.items.length || !canCreateInvoice} data-resilient-action>{busy ? t("processing") : !canCreateInvoice ? "Upgrade to create invoices" : <><Check size={17} /> {t("finalizeInvoice")}</>}</button>
          <p className="muted mt-3 text-center text-xs">{t("stockAtomic")}</p>
      </section>
    </form>
  </div>;
}

function InventoryView({ language, products, canManage, onAdd, onEdit, onDelete, search, setSearch }: { language: Language; products: Product[]; canManage: boolean; onAdd: () => void; onEdit: (product: Product) => void; onDelete: (product: Product) => void; search: string; setSearch: (v: string) => void }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const filtered = products.filter((item) => `${item.name} ${item.sku} ${item.hsnCode}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">{t("catalogStock")}</p><h2 className="mt-1 text-2xl font-bold">{t("inventoryTitle")}</h2><p className="muted mt-1 text-sm">{t("inventoryHint")}</p></div>{canManage && <button className="button button-primary" onClick={onAdd}><Plus size={16} /> {t("addItem")}</button>}</div>
    <section className="panel content-card">
      <div className="relative mb-4 max-w-md"><Search className="muted absolute left-3 top-1/2 -translate-y-1/2" size={16} /><input className="field pl-10" placeholder={t("searchCatalog")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>{t("item")}</th><th>{t("itemSkuHsn")}</th><th>{t("price")}</th><th>{t("stock")}</th><th>{t("alertAt")}</th><th>{t("gst")}</th>{canManage && <th>{t("stockValue")}</th>}{canManage && <th>{t("manage")}</th>}</tr></thead>
        <tbody>{filtered.map((item) => <tr className="table-row" key={item.id}><td className="font-semibold">{item.name}</td><td><span>{item.sku}</span><small className="muted block">{item.hsnCode || "—"}</small></td><td>{money(item.price)}</td><td><span className={item.lowStock ? "font-bold text-amber-700" : ""}>{item.stock} {item.unit}</span></td><td>{item.lowStockAt} {item.unit}</td><td>{item.gstRate}%</td>{canManage && <td>{money(item.price * item.stock)}</td>}{canManage && <td><div className="flex gap-1"><button className="button button-soft !px-2 !py-1 text-xs" onClick={() => onEdit(item)}>{t("edit")}</button><button className="button button-danger !p-2" onClick={() => onDelete(item)} aria-label={`${t("delete")} ${item.name}`}><Trash2 size={14} /></button></div></td>}</tr>)}</tbody>
      </table></div>
      {filtered.length === 0 && <p className="muted py-8 text-center text-sm">{t("noMatchingItems")}</p>}
    </section>
  </section>;
}

function QuotationView({ products, lines, onChange, canManage, onAddItem, onCreateQuotation, onPushToBill }: {
  products: Product[];
  lines: BillLine[];
  onChange: (lines: BillLine[]) => void;
  canManage: boolean;
  onAddItem: () => void;
  onCreateQuotation: () => void;
  onPushToBill: () => void;
}) {
  const selectedIds = new Set(lines.map((line) => line.productId));
  const canContinue = lines.length > 0 && lines.every((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product !== undefined && line.quantity > 0 && line.quantity <= product.stock;
  });
  const selectedTotal = lines.reduce((total, line) => {
    const product = products.find((item) => item.id === line.productId);
    return total + Math.round((product?.price || 0) * line.quantity * 100) / 100;
  }, 0);

  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Electrical items</p><h2 className="mt-1 text-2xl font-bold">Quotation / Price List</h2><p className="muted mt-1 text-sm">Select stocked electrical items to create a shareable quotation or move them directly to checkout.</p></div>
      <div className="flex flex-wrap gap-2">
        {canManage
          ? <button className="button button-soft" onClick={onAddItem}><Plus size={16} /> Add Item</button>
          : <span className="muted self-center text-xs">Adding items requires administrator access.</span>}
        <button className="button button-soft" onClick={onCreateQuotation} disabled={!canContinue}><Download size={16} /> Create Quotation</button>
        <button className="button button-primary" onClick={onPushToBill} disabled={!canContinue}><ShoppingCart size={16} /> Push to Bill</button>
      </div>
    </div>
    <section className="panel content-card">
      <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Include</th><th>SKU</th><th>Item Name</th><th>Base Price</th><th>Stock</th><th>Quantity</th></tr></thead>
        <tbody>{products.map((product) => {
          const selected = lines.find((line) => line.productId === product.id);
          return <tr className="table-row" key={product.id}>
            <td><input aria-label={`Include ${product.name}`} type="checkbox" disabled={product.stock <= 0} checked={Boolean(selected)} onChange={(event) => onChange(event.target.checked
              ? [...lines, { productId: product.id, quantity: 1 }]
              : lines.filter((line) => line.productId !== product.id))} /></td>
            <td className="font-mono text-xs">{product.sku}</td>
            <td className="font-semibold">{product.name}</td>
            <td>{money(product.price)}</td>
            <td>{product.stock} {product.unit}</td>
            <td>{selected && <input className="field !w-24 !py-1.5" aria-label={`${product.name} quotation quantity`} type="number" min=".001" step=".001" max={product.stock} value={selected.quantity} onChange={(event) => onChange(lines.map((line) => line.productId === product.id ? { ...line, quantity: Number(event.target.value) } : line))} />}</td>
          </tr>;
        })}</tbody></table></div>
      {products.length === 0 && <p className="muted py-8 text-center text-sm">No catalog items are available yet.</p>}
      <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-[var(--line)] pt-4 text-sm">
        <span className="muted">{selectedIds.size} selected item{selectedIds.size === 1 ? "" : "s"}</span><span className="font-bold">Quotation subtotal: {money(selectedTotal)}</span>
      </div>
    </section>
  </section>;
}

function ProductPicker({ products, value, onChange }: { products: Product[]; value: string; onChange: (productId: string) => void }) {
  const [query, setQuery] = useState("");
  const selectedProduct = products.find((product) => product.id === value);
  const matches = products.filter((product) => `${product.name} ${product.sku} ${product.hsnCode}`.toLowerCase().includes(query.trim().toLowerCase()));
  const options = selectedProduct && !matches.some((product) => product.id === selectedProduct.id)
    ? [selectedProduct, ...matches]
    : matches;
  return <div className="min-w-0">
    <Field label="Search items"><input className="field !py-2" type="search" aria-label="Search products by name, SKU, or HSN" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, SKU, or HSN" /></Field>
    <Field label="Item"><select className="field !mt-2 !py-2" required value={value} onChange={(event) => onChange(event.target.value)} aria-label="Select item">
      {options.map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.price)} · {product.stock} {product.unit}</option>)}
    </select></Field>
    {matches.length === 0 && <p className="muted mt-1 text-xs">No items match that search.</p>}
  </div>;
}

function ProductEditorView({ product, setProduct, editing, busy, onSave, onCancel }: {
  product: ProductDraft; setProduct: (product: ProductDraft) => void; editing: boolean; busy: boolean;
  onSave: (event: FormEvent) => void; onCancel: () => void;
}) {
  return <section className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Catalog & stock</p><h2 className="mt-1 text-2xl font-bold">{editing ? "Edit inventory item" : "Create inventory item"}</h2><p className="muted mt-1 text-sm">Set item details, pricing, available quantity, and the low-stock alert threshold.</p></div>
      <button type="button" className="button button-quiet" onClick={onCancel}><ChevronRight size={16} className="rotate-180" /> Back</button>
    </div>
    <form className="panel content-card space-y-5" onSubmit={onSave}>
      <div className="form-grid">
        <Field label="Item name"><input className="field" required maxLength={120} value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} /></Field>
        <Field label="SKU / item code"><input className="field" required maxLength={80} value={product.sku} onChange={(e) => setProduct({ ...product, sku: e.target.value })} /></Field>
        <Field label="Unit price (₹)"><input className="field" type="number" min="0" step=".01" required value={product.price} onChange={(e) => setProduct({ ...product, price: e.target.value })} /></Field>
        <Field label="Available stock"><input className="field" type="number" min="0" step=".001" required value={product.stock} onChange={(e) => setProduct({ ...product, stock: e.target.value })} /></Field>
        <Field label="Low-stock threshold"><input className="field" type="number" min="0" step=".001" required value={product.lowStockAt} onChange={(e) => setProduct({ ...product, lowStockAt: e.target.value })} /></Field>
        <Field label="GST rate (%)"><input className="field" type="number" min="0" max="100" step=".01" required value={product.gstRate} onChange={(e) => setProduct({ ...product, gstRate: e.target.value })} /></Field>
        <Field label="HSN / SAC code"><input className="field" maxLength={20} value={product.hsnCode} onChange={(e) => setProduct({ ...product, hsnCode: e.target.value })} /></Field>
        <Field label="Unit"><input className="field" required maxLength={24} value={product.unit} onChange={(e) => setProduct({ ...product, unit: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] pt-4">
        <button type="button" className="button button-quiet" onClick={onCancel}>Cancel</button>
        <button className="button button-primary" disabled={busy} data-resilient-action>{busy ? "Saving..." : <><Check size={16} /> {editing ? "Save changes" : "Create item"}</>}</button>
      </div>
    </form>
  </section>;
}

function LowStockView({ language, products, canManage, onInventory, onEdit }: { language: Language; products: Product[]; canManage: boolean; onInventory: () => void; onEdit: (product: Product) => void }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">{t("catalogStock")}</p><h2 className="mt-1 text-2xl font-bold">{t("lowStockTitle")}</h2><p className="muted mt-1 text-sm">{t("lowStockHint")}</p></div><button className="button button-soft" onClick={onInventory}><Package size={16} /> {t("inventory")}</button></div>
    <section className="panel content-card">
      {products.length ? <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>{t("item")}</th><th>SKU</th><th>{t("availableQuantity")}</th><th>{t("alertLevel")}</th>{canManage && <th>{t("manage")}</th>}</tr></thead><tbody>
        {products.map((item) => <tr className="table-row" key={item.id}><td className="font-semibold">{item.name}</td><td>{item.sku || "—"}</td><td className="font-bold text-amber-700">{item.stock} {item.unit}</td><td>{item.lowStockAt} {item.unit}</td>{canManage && <td><button className="button button-soft !px-3 !py-2 text-xs" onClick={() => onEdit(item)}>{t("updateStock")}</button></td>}</tr>)}
      </tbody></table></div> : <p className="muted py-8 text-center text-sm">No items are currently at their low-stock threshold.</p>}
    </section>
  </section>;
}

function PaymentsView({ language, pendingInvoices, completedInvoices, recentPayments, paymentSummary, customers, onPayment, onPreview, onBilling }: {
  language: Language; pendingInvoices: Invoice[]; completedInvoices: Invoice[]; paymentSummary: { totalBilled: number; totalReceived: number; pendingCount: number; completedCount: number };
  recentPayments: PaymentActivity[];
  customers: Customer[]; onPayment: (invoice: Invoice) => void; onPreview: (invoice: Invoice) => void; onBilling: () => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">{t("accounting")}</p><h2 className="mt-1 text-2xl font-bold">{t("accountingTitle")}</h2><p className="muted mt-1 text-sm">{t("accountingHint")}</p></div><button className="button button-primary" onClick={onBilling}><Plus size={16} /> {t("createBill")}</button></div>
    <div className="metric-grid">
      <Metric icon={Receipt} label={t("totalBilled")} value={money(paymentSummary.totalBilled)} note={t("allInvoices")} />
      <Metric icon={CircleDollarSign} label={t("amountReceivedTotal")} value={money(paymentSummary.totalReceived)} note={`${paymentSummary.completedCount} ${t("fullyPaidInvoices")}`} />
      <Metric icon={Activity} label={t("amountPending")} value={money(paymentSummary.totalBilled - paymentSummary.totalReceived)} note={`${paymentSummary.pendingCount} ${t("invoicesNeedPayment")}`} />
    </div>
    <section className="panel content-card">
      <div className="mb-3"><h3 className="font-bold">{t("pendingBalances")}</h3><p className="muted mt-1 text-sm">{t("outstandingInvoices")}</p></div>
      <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Customer</th><th>Invoice</th><th>Invoice total</th><th>Received</th><th>Balance due</th><th>Last method</th><th>Status</th><th></th></tr></thead><tbody>
        {pendingInvoices.map((invoice) => {
          const customer = customerById.get(invoice.customerId || "");
          const message = `Hello ${invoice.customerName}, your balance for ${invoice.number} is ${money(numeric(invoice.grandTotal) - numeric(invoice.amountPaid))}. Please contact us if you need a payment update.`;
          const reminderUrl = customer ? whatsappUrl(customer.phone, message) : "";
          return <tr className="table-row" key={invoice.id}><td className="font-semibold">{invoice.customerName}</td><td>{invoice.number}</td><td>{money(invoice.grandTotal)}</td><td>{money(invoice.amountPaid)}</td><td className="font-bold text-amber-700">{money(numeric(invoice.grandTotal) - numeric(invoice.amountPaid))}</td><td>{invoice.paymentMethod || "—"}</td><td><span className={`tag tag-${invoice.paymentStatus === "PARTIAL" ? "partial" : "unpaid"}`}>{invoice.paymentStatus}</span></td><td><button className="button button-soft !px-3 !py-2 text-xs" onClick={() => onPayment(invoice)}>{t("recordPayment")}</button><button className="button button-quiet !px-3 !py-2 text-xs" onClick={() => onPreview(invoice)}>{t("paymentHistory")}</button>{reminderUrl && <a className="button button-quiet ml-1 !px-3 !py-2 text-xs" href={reminderUrl} target="_blank" rel="noreferrer">Send WhatsApp reminder</a>}</td></tr>;
        })}
      </tbody></table></div>
      {pendingInvoices.length === 0 && <p className="muted py-8 text-center text-sm">No pending invoice balances.</p>}
    </section>
    <section className="panel content-card">
      <div className="mb-3"><h3 className="font-bold">{t("completedPayments")}</h3><p className="muted mt-1 text-sm">{t("fullyPaidInvoices")} (up to 200); totals above include all invoices.</p></div>
      <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Customer</th><th>Invoice</th><th>Completed on</th><th>Amount paid</th><th>Payment method</th><th>Status</th><th></th></tr></thead><tbody>
        {completedInvoices.map((invoice) => <tr className="table-row" key={invoice.id}><td className="font-semibold">{invoice.customerName}</td><td>{invoice.number}</td><td>{formatDate(invoice.payments.at(-1)?.receivedAt || invoice.issuedAt, true)}</td><td className="font-semibold text-emerald-700">{money(invoice.amountPaid)}</td><td>{invoice.paymentMethod || "—"}</td><td><span className="tag tag-paid">Paid</span></td><td><button className="button button-quiet !px-3 !py-2 text-xs" onClick={() => onPreview(invoice)}>History</button></td></tr>)}
      </tbody></table></div>
      {completedInvoices.length === 0 && <p className="muted py-8 text-center text-sm">No fully paid invoices yet.</p>}
    </section>
    <section className="panel content-card">
      <div className="mb-3"><h3 className="font-bold">{t("recentPaymentActivity")}</h3><p className="muted mt-1 text-sm">Latest 100 recorded payment transactions across pending and completed invoices.</p></div>
      <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Received</th><th>Customer</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Recorded by</th><th></th></tr></thead><tbody>
        {recentPayments.map((payment) => <tr className="table-row" key={payment.id}><td>{formatDate(payment.receivedAt)}</td><td>{payment.invoice.customerName}</td><td>{payment.invoice.number}</td><td className="font-semibold">{money(payment.amount)}</td><td>{payment.isLegacySnapshot ? "Opening balance snapshot" : payment.paymentMethod || "—"}</td><td>{payment.receivedBy}</td><td><button className="button button-quiet !px-3 !py-2 text-xs" onClick={() => onPreview(payment.invoice)}>Invoice</button></td></tr>)}
      </tbody></table></div>
      {recentPayments.length === 0 && <p className="muted py-8 text-center text-sm">No payment transactions have been recorded yet.</p>}
    </section>
  </section>;
}

function AgentWorkbenchView({ language, isAdmin, products, onStageLine }: { language: Language; isAdmin: boolean; products: Product[]; onStageLine: (productId: string, quantity: number, destination: VoiceDestination) => string }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<"TEXT" | "VOICE">("TEXT");
  const [screenshot, setScreenshot] = useState("");
  const [screenshotName, setScreenshotName] = useState("");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<VoiceMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [destination, setDestination] = useState<VoiceDestination>("billing");
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    recognition.current?.stop();
    chatAbort.current?.abort();
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages]);

  const loadTasks = useCallback(async () => {
    if (!isAdmin) return;
    const result = await api<{ tasks: AgentTask[] }>("/api/agent/tasks");
    const priority = { OPEN: 0, REVIEWED: 1, DISMISSED: 2 };
    setTasks([...result.tasks].sort((first, second) =>
      priority[first.status] - priority[second.status] || new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
    ));
  }, [isAdmin]);

  useEffect(() => {
    void loadTasks().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load agent requests"));
  }, [loadTasks]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadTasks().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not refresh agent requests"));
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [isAdmin, loadTasks]);

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setMessage("Speech recognition is not available in this browser. You can type or paste a transcript.");
      return;
    }
    const instance = new Recognition();
    recognition.current = instance;
    instance.lang = languageOptions.find((option) => option.code === language)?.locale || navigator.language || "en-IN";
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length - event.resultIndex }, (_, index) =>
        event.results[event.resultIndex + index][0]?.transcript || "",
      ).filter(Boolean).join(" ").trim();
      if (transcript) {
        setDescription((current) => `${current}${current.trim() ? " " : ""}${transcript}`);
        setSource("VOICE");
      }
    };
    instance.onerror = (event) => setMessage(`Microphone recognition failed: ${event.error}`);
    instance.onend = () => setListening(false);
    setMessage("Recording starts only after browser microphone permission. Speech processing follows your browser's recognition service.");
    setListening(true);
    try {
      instance.start();
    } catch (error) {
      setListening(false);
      setMessage(error instanceof Error ? error.message : "Could not start speech recognition");
    }
  }

  async function attachScreenshot(file: File | undefined) {
    setScreenshot("");
    setScreenshotName("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage("Choose a PNG, JPEG, or WebP screenshot.");
      return;
    }
    if (file.size > 700_000) {
      setMessage("Screenshot must be no larger than 700 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setMessage("Screenshot could not be read.");
        return;
      }
      setScreenshot(reader.result);
      setScreenshotName(file.name);
      setMessage("Screenshot is ready. It is saved only when you submit this request.");
    };
    reader.onerror = () => setMessage("Screenshot could not be read.");
    reader.readAsDataURL(file);
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api<{ task: AgentTask }>("/api/agent/tasks", {
        method: "POST",
        body: JSON.stringify({ description, source, screenshot: screenshot || null }),
      });
      setDescription("");
      setSource("TEXT");
      setScreenshot("");
      setScreenshotName("");
      setMessage("Request saved for human review. This workflow does not authorize or apply code or deployment actions.");
      await loadTasks();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit request");
    } finally {
      setBusy(false);
    }
  }

  async function updateTaskStatus(task: AgentTask, status: "REVIEWED" | "DISMISSED") {
    try {
      await api(`/api/agent/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadTasks();
      setMessage(status === "REVIEWED" ? "Request marked reviewed." : "Request dismissed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update request");
    }
  }

  return <section className="space-y-5">
    <AgentGallery isAdmin={isAdmin} />
    <div><p className="eyebrow">{t("agentRequests")}</p><h2 className="mt-1 text-2xl font-bold">{t("agentTitle")}</h2><p className="muted mt-1 text-sm">{t("agentHint")}</p></div>
    <div className="panel content-card space-y-3">
      <div>
        <p className="font-bold">Voice & business assistant</p>
        <p className="muted mt-1 text-sm">Ask about catalog items, prices, and stock, or stage a bill/quotation line. The assistant cannot check out, record payments, or change inventory. Do not share customer details, passwords, or other sensitive information.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="muted flex items-center gap-2 text-sm">Stage commands to
          <select className="field !w-auto !py-2" value={destination} onChange={(event) => setDestination(event.target.value as VoiceDestination)}>
            <option value="billing">bill draft</option>
            <option value="quotation">quotation draft</option>
          </select>
        </label>
        <span className="muted self-center text-xs">Command format: “Add 2 exact SKU” or “Add 2 exact item name to quotation”. Use an exact SKU or full item name.</span>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-[var(--line)] bg-white/60 p-3" aria-live="polite">
        {chatMessages.map((chatMessage, index) => <div key={`${index}-${chatMessage.role}`} className={`flex ${chatMessage.role === "user" ? "justify-end" : "justify-start"}`}>
          <p className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${chatMessage.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-900"}`}>
            <span className="mb-1 block text-xs font-bold opacity-70">{chatMessage.role === "user" ? "You" : "Assistant"}</span>
            {chatMessage.content || (voiceBusy ? "…" : "")}
          </p>
        </div>)}
        <div ref={chatEnd} />
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void sendChatMessage(chatInput); }}>
        <input className="field min-w-[12rem] flex-1" value={chatInput} onChange={(event) => setChatInput(event.target.value)} maxLength={4_000} placeholder="Ask a business question or stage a draft line…" disabled={voiceBusy} />
        <button type="button" className="button button-soft" onClick={voiceListening ? () => recognition.current?.stop() : startConversationVoice} aria-pressed={voiceListening} disabled={voiceBusy}><Mic size={16} />{voiceListening ? "Stop" : "Speak"}</button>
        {voiceBusy
          ? <button type="button" className="button button-quiet" onClick={() => chatAbort.current?.abort()}>Stop response</button>
          : <button className="button button-primary" disabled={!chatInput.trim()}>Send</button>}
      </form>
      {voiceMessage && <p className="muted text-sm" role="status">{voiceMessage}</p>}
    </div>
    <form className="panel content-card space-y-4" onSubmit={submitRequest}>
      <Field label={t("agentInputLabel")}>
        <textarea className="field min-h-32 resize-y" required minLength={3} maxLength={10_000} value={description} onChange={(event) => { setDescription(event.target.value); setSource("TEXT"); }} placeholder={t("agentPlaceholder")} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="button button-soft" onClick={listening ? () => recognition.current?.stop() : startVoiceInput} aria-pressed={listening}><Mic size={16} />{listening ? t("stopDictation") : t("dictate")}</button>
        <label className="button button-soft cursor-pointer"><Upload size={16} />{t("attachScreenshot")}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void attachScreenshot(event.target.files?.[0])} /></label>
        {screenshotName && <span className="muted text-sm">{screenshotName}</span>}
        <button className="button button-primary ml-auto" disabled={busy || description.trim().length < 3}>{busy ? t("processing") : t("submitRequest")}</button>
      </div>
      {screenshot && <img className="max-h-80 max-w-full rounded-xl border border-[var(--line)] object-contain" src={screenshot} alt="Screenshot attached to this request" />}
      {message && <p className="muted text-sm" role="status">{message}</p>}
    </form>
    {isAdmin && <section className="panel content-card">
      <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="font-bold">{t("requestQueue")}</h3><p className="muted mt-1 text-sm">Review status records triage only; it does not authorize or apply code changes.</p></div><button type="button" className="button button-soft !px-3 !py-2 text-sm" onClick={() => void loadTasks()}><RotateCcw size={15} /> Refresh</button></div>
      <div className="space-y-3">
        {tasks.map((task) => <article key={task.id} className="rounded-xl border border-[var(--line)] bg-white/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><span className={`tag ${task.status === "REVIEWED" ? "tag-paid" : task.status === "DISMISSED" ? "tag-unpaid" : "tag-partial"}`}>{task.status}</span><p className="muted mt-2 text-xs">{task.createdBy} · {formatDate(task.createdAt)} · {task.source === "VOICE" ? "Voice transcript" : "Typed request"}</p></div>{task.status === "OPEN" && <div className="flex gap-2"><button type="button" className="button button-soft !px-3 !py-2 text-xs" onClick={() => void updateTaskStatus(task, "REVIEWED")}>{t("markReviewed")}</button><button type="button" className="button button-quiet !px-3 !py-2 text-xs" onClick={() => void updateTaskStatus(task, "DISMISSED")}>{t("dismissRequest")}</button></div>}</div>
          <p className="mt-3 whitespace-pre-wrap text-sm">{task.description}</p>
          {task.screenshotMime && <img className="mt-3 max-h-80 rounded-xl border border-[var(--line)] object-contain" src={`/api/agent/tasks/${task.id}/screenshot`} alt={`Screenshot attached by ${task.createdBy}`} />}
          {task.reviewedBy && <p className="muted mt-3 text-xs">Reviewed by {task.reviewedBy}{task.reviewedAt ? ` · ${formatDate(task.reviewedAt)}` : ""}</p>}
        </article>)}
        {tasks.length === 0 && <p className="muted py-8 text-center text-sm">{t("noRequests")}</p>}
      </div>
    </section>}
  </section>;
}

function CustomersView({ language, customers, balances, canViewFinancials, onAdd, onEdit, onDelete, onPayments, search, setSearch }: { language: Language; customers: Customer[]; balances: CustomerBalance[]; canViewFinancials: boolean; onAdd: () => void; onEdit: (customer: Customer) => void; onDelete: (customer: Customer) => void; onPayments: () => void; search: string; setSearch: (v: string) => void }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const filtered = customers.filter((customer) => `${customer.name} ${customer.phone} ${customer.gstin}`.toLowerCase().includes(search.toLowerCase()));
  const balanceByCustomer = new Map(balances.map((balance) => [balance.customerId, balance]));
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">{t("customers")}</p><h2 className="mt-1 text-2xl font-bold">{t("customerPageTitle")}</h2><p className="muted mt-1 text-sm">{t("customerPageHint")}</p></div><div className="flex gap-2">{canViewFinancials && <button className="button button-soft" onClick={onPayments}><CircleDollarSign size={16} /> {t("pendingBalances")}</button>}<button className="button button-primary" onClick={onAdd}><Plus size={16} /> {t("addCustomer")}</button></div></div>
    <section className="panel content-card">
      <div className="relative mb-4 max-w-md"><Search className="muted absolute left-3 top-1/2 -translate-y-1/2" size={16} /><input className="field pl-10" placeholder={t("searchCustomers")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>{t("customer")}</th><th>Phone</th><th>Email</th>{canViewFinancials && <><th>{t("billed")}</th><th>{t("received")}</th><th>{t("pending")}</th><th>{t("paymentStatusLabel")}</th></>}<th>{t("state")}</th><th aria-label="Actions" /></tr></thead><tbody>
        {filtered.map((customer) => { const account = balanceByCustomer.get(customer.id) || { billed: 0, paid: 0, due: 0 }; const status = account.due > 0 ? (account.paid > 0 ? t("partial") : t("pending")) : account.paid > 0 ? t("paid") : "—"; return <tr className="table-row" key={customer.id}><td className="font-semibold">{customer.name}</td><td>{customer.phone || "—"}</td><td>{customer.email || "—"}</td>{canViewFinancials && <><td>{money(account.billed)}</td><td>{money(account.paid)}</td><td className={account.due > 0 ? "font-bold text-amber-700" : ""}>{money(account.due)}</td><td><span className={`tag tag-${account.due > 0 ? "partial" : "paid"}`}>{status}</span></td></>}<td>{customer.state || stateOptions.find(([code]) => code === customer.stateCode)?.[1] || customer.stateCode}</td><td className="whitespace-nowrap text-right"><button className="button button-quiet !px-2 !py-1 text-xs" onClick={() => onEdit(customer)}>Edit</button>{canViewFinancials && <button className="button button-danger ml-1 !px-2 !py-1 text-xs" onClick={() => onDelete(customer)} aria-label={`Delete ${customer.name}`}><Trash2 size={13} /></button>}</td></tr>; })}
      </tbody></table></div>
      {filtered.length === 0 && <p className="muted py-8 text-center text-sm">{t("noCustomers")}</p>}
    </section>
  </section>;
}

function TeamView({ users, onAdd, onRemove }: { users: User[]; onAdd: () => void; onRemove: (user: User) => void }) {
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Access management</p><h2 className="mt-1 text-2xl font-bold">Team access</h2><p className="muted mt-1 text-sm">Cashiers can checkout and manage customer records; company settings and financial summaries stay admin-only.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={16} /> Create account</button></div>
    <section className="panel content-card">
      <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Member</th><th>Username</th><th>Role</th><th>Workspace access</th><th></th></tr></thead><tbody>
        {users.map((member) => <tr className="table-row" key={member.id}><td className="font-semibold">{member.displayName}</td><td>{member.username}</td><td><span className="tag">{member.role === "ADMIN" ? "Administrator" : member.role === "CUSTOMER" ? "Customer" : "Sales"}</span></td><td>{member.role === "ADMIN" ? "Full tenant administration" : member.role === "CUSTOMER" ? "Customer portal only" : "Checkout · inventory lookup · customers"}</td><td className="text-right"><button className="button button-danger !px-3 !py-2 text-xs" onClick={() => onRemove(member)}><Trash2 size={14} /> Remove</button></td></tr>)}
      </tbody></table></div>
    </section>
  </section>;
}

function SettingsView({ company, setCompany, busy, onSave, onVerify, onRotateKey, onEnableNotifications }: { company: Company; setCompany: (value: Company) => void; busy: boolean; onSave: (event: FormEvent) => void; onVerify: () => void; onRotateKey: () => void; onEnableNotifications: () => void }) {
  return <section className="space-y-5">
    <div><p className="eyebrow">White-label experience</p><h2 className="mt-1 text-2xl font-bold">Brand & business settings</h2><p className="muted mt-1 text-sm">Saved settings apply across the workspace, new invoices, and generated documents.</p></div>
    <form className="workspace-grid items-start" onSubmit={onSave}>
      <section className="panel content-card">
        <h3 className="font-bold">Business identity</h3><div className="form-grid mt-4">
          <Field label="Display brand"><input className="field" required value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder="Dark World" /></Field>
          <Field label="Legal entity"><input className="field" required value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} placeholder="Chinnathambi Traders" /></Field>
          <Field label="GSTIN"><input className="field" maxLength={15} value={company.gstin} onChange={(e) => setCompany({ ...company, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Registered state"><StateSelect value={company.stateCode} onChange={(value) => setCompany({ ...company, stateCode: value })} /></Field>
          <Field label="UPI ID for invoice QR"><input className="field" value={company.upiId} onChange={(e) => setCompany({ ...company, upiId: e.target.value })} placeholder="business@upi" /></Field>
          <Field label="Invoice style"><select className="field" value={company.theme} onChange={(e) => setCompany({ ...company, theme: e.target.value as ThemeName })}>{Object.entries(themes).map(([key, theme]) => <option value={key} key={key}>{theme.label}</option>)}</select></Field>
        </div>
        <div className="mt-5">
          <Field label="Company logo">
            <CompanyLogoUpload value={company.logoData} onChange={(logoData) => setCompany({ ...company, logoData })} />
          </Field>
          <p className="muted mt-2 text-xs">The logo is stored with encrypted business settings and snapshotted onto new invoices.</p>
        </div>
        <div className="mt-5 rounded-xl border border-[var(--line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Business notifications</p><p className="muted mt-1 text-xs">In-app alerts are automatic; browser alerts also need permission on each device.</p></div><button type="button" className="button button-soft !px-3 !py-2 text-xs" onClick={onEnableNotifications}>Enable browser alerts</button></div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={company.lowStockNotifications} onChange={(e) => setCompany({ ...company, lowStockNotifications: e.target.checked })} /> Low-stock alerts</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={company.paymentNotifications} onChange={(e) => setCompany({ ...company, paymentNotifications: e.target.checked })} /> Payment alerts</label>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2"><button className="button button-primary" disabled={busy} data-resilient-action><Check size={16} /> Save settings</button><button type="button" className="button button-soft" onClick={onVerify}><ShieldCheck size={16} /> Verify GSTIN online</button></div>
        <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="font-semibold">Device integration</p><p className="muted mt-1 text-xs">Rotating this credential immediately revokes the existing tenant API key.</p><button type="button" className="button button-quiet mt-2 !px-0 text-sm" onClick={onRotateKey}><Settings2 size={15} /> Rotate tenant API key</button></div>
        <p className="muted mt-4 text-xs">GSTIN format is validated locally. Government verification requires an authorized GSTN/GSP provider configured by your operator.</p>
      </section>
      <section className="panel content-card">
        <p className="eyebrow">Live style preview</p><h3 className="mt-1 text-lg font-bold">{themes[company.theme]?.label}</h3>
        <div className={`mt-4 rounded-2xl border border-[var(--line)] bg-white p-5 theme-${company.theme}`}>
          {company.logoData && <img src={company.logoData} alt="Company logo preview" className="invoice-company-logo mb-3" />}
          <span className="invoice-accent">Tax invoice</span><p className="mt-5 text-xl font-bold">{company.legalName || "Your legal entity"}</p><p className="muted mt-1 text-sm">{company.name || "Your brand"}</p>
          <div className="mt-6 flex items-center justify-between rounded-xl bg-[var(--accent-soft)] p-3"><span className="text-sm font-semibold text-[var(--accent)]">Bill total</span><span className="font-bold">₹ 12,450.00</span></div>
        </div>
        <div className="mt-5 space-y-2">{Object.entries(themes).map(([key, theme]) => <button key={key} className="flex w-full items-center justify-between rounded-xl p-2.5 text-left text-sm hover:bg-[var(--accent-soft)]" type="button" onClick={() => setCompany({ ...company, theme: key as ThemeName })}><span>{theme.label}</span>{company.theme === key && <Check size={16} className="text-[var(--accent)]" />}</button>)}</div>
      </section>
    </form>
  </section>;
}

function ComplianceView({ invoices, onExport, onExportLedger }: { invoices: Invoice[]; onExport: () => void; onExportLedger: () => void }) {
  const year = new Date().getFullYear();
  const annual = invoices.filter((invoice) => new Date(invoice.issuedAt).getFullYear() === year);
  const taxable = annual.reduce((sum, invoice) => sum + invoice.items.reduce((total, item) => total + numeric(item.taxableValue), 0), 0);
  const tax = annual.reduce((sum, invoice) => sum + numeric(invoice.taxTotal), 0);
  async function exportReturn(report: "gstr1" | "gstr2b" | "gstr3b") {
    const response = await fetch(`/api/admin/compliance/export?report=${report}&format=json&year=${year}`);
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `${report}-${year}.json`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="space-y-5">
    <div><p className="eyebrow">GST compliance workspace</p><h2 className="mt-1 text-2xl font-bold">Tax summaries & filings</h2><p className="muted mt-1 text-sm">Export invoice-level yearly data to prepare statutory returns.</p></div>
    <div className="metric-grid"><Metric icon={Receipt} label={`${year} invoices`} value={String(annual.length)} note="Issued tax invoices" /><Metric icon={BarChart3} label="Taxable turnover" value={money(taxable)} note="Based on invoice line items" /><Metric icon={CircleDollarSign} label="GST charged" value={money(tax)} note="CGST, SGST, and IGST" /><Metric icon={FileText} label="Return status" value="Export ready" note="Review with your tax professional" /></div>
    <section className="panel content-card">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-bold">Annual GST invoice summary</h3><p className="muted mt-1 max-w-2xl text-sm">Creates downloadable GSTR-ready JSON/CSV data with HSN summaries and posted credit/debit adjustments. Government submission still requires an authorized provider.</p></div><div className="flex flex-wrap gap-2"><button className="button button-soft" onClick={onExportLedger} data-resilient-action><Download size={16} /> Export sales ledger</button><button className="button button-primary" onClick={onExport} data-resilient-action><Download size={16} /> Export {year} summary</button></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><button className="button button-soft !px-3 !py-2 text-xs" onClick={() => void exportReturn("gstr1")}>GSTR-1 JSON</button><button className="button button-soft !px-3 !py-2 text-xs" onClick={() => void exportReturn("gstr2b")}>GSTR-2B JSON</button><button className="button button-soft !px-3 !py-2 text-xs" onClick={() => void exportReturn("gstr3b")}>GSTR-3B JSON</button></div>
      <div className="mt-5 flex gap-2 rounded-xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]"><ShieldCheck size={17} className="shrink-0" /><span>Government GSTIN verification and filing require authorized GSTN/GSP credentials. The app reports an unverified status until an operator configures a provider.</span></div>
    </section>
  </section>;
}

function AuditView({ entries, users }: { entries: AuditEntry[]; users: User[] }) {
  return <section className="space-y-5">
    <div><p className="eyebrow">Accountability</p><h2 className="mt-1 text-2xl font-bold">Audit trail</h2><p className="muted mt-1 text-sm">Recent administrative, inventory, customer, and billing changes.</p></div>
    <section className="panel content-card"><div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>When</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>
      {entries.map((entry) => <tr className="table-row" key={entry.id}><td>{formatDate(entry.createdAt)}</td><td>{users.find((member) => member.id === entry.actorId)?.displayName || entry.actorId.slice(0, 8)}</td><td className="font-semibold">{entry.action}</td><td><code className="text-xs">{entry.subject.slice(0, 12)}</code></td><td className="max-w-[240px] truncate text-xs">{JSON.stringify(entry.details)}</td></tr>)}
    </tbody></table></div>{entries.length === 0 && <p className="muted py-8 text-center text-sm">Audit events will appear here as your team works.</p>}</section>
  </section>;
}

function CustomerPortalView({ onPreview }: { onPreview: (invoice: Invoice) => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ invoices: Invoice[] }>("/api/portal/invoices").then((result) => setInvoices(result.invoices)).catch((reason) => setError(reason instanceof Error ? reason.message : "Portal records could not be loaded"));
  }, []);
  return <section className="space-y-5">
    <div><p className="eyebrow">Secure customer area</p><h2 className="mt-1 text-2xl font-bold">Your invoices & statements</h2><p className="muted mt-1 text-sm">Only documents linked to your customer account are visible here.</p></div>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <section className="panel content-card"><InvoiceTable invoices={invoices} onPreview={onPreview} onPayment={() => undefined} allowPayment={false} /></section>
  </section>;
}

function TemplateGalleryView() {
  const [templates, setTemplates] = useState<Array<{ code: string; name: string; documentKind: string; schema: { accent: string; background: string; logoPlacement: string; columns: string[]; signature: boolean; paper: string } }>>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { api<{ templates: typeof templates }>("/api/templates/gallery").then((result) => { setTemplates(result.templates); setSelected(result.templates[0]?.code || ""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Template gallery is unavailable")); }, []);
  const active = templates.find((template) => template.code === selected);
  return <section className="space-y-5">
    <div><p className="eyebrow">Cloud template gallery</p><h2 className="mt-1 text-2xl font-bold">20+ layouts for every document</h2><p className="muted mt-1 text-sm">Choose GST invoices, retail bills, thermal receipts, quotations, or purchase orders. Logo placement, signature blocks, colors, paper width, and columns are schema-driven.</p></div>
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{templates.slice(0, 100).map((template) => <button key={template.code} type="button" className={`panel p-3 text-left ${selected === template.code ? "ring-2 ring-[var(--accent)]" : ""}`} onClick={() => setSelected(template.code)}><div className="h-24 rounded-lg p-3" style={{ background: template.schema.background, borderTop: `5px solid ${template.schema.accent}` }}><div className="flex justify-between text-[10px] font-bold"><span>{template.schema.logoPlacement} logo</span><span>{template.schema.paper}</span></div><div className="mt-5 grid grid-cols-3 gap-1">{template.schema.columns.slice(0, 3).map((column) => <span key={column} className="h-1 rounded bg-black/20" />)}</div></div><p className="mt-2 truncate text-sm font-bold">{template.name}</p><p className="muted mt-1 text-xs">{template.documentKind.replaceAll("_", " ")} · {template.schema.signature ? "Signature" : "No signature"}</p></button>)}</div>
    {active && <section className="panel content-card"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Selected template</p><h3 className="mt-1 text-lg font-bold">{active.name}</h3><p className="muted mt-1 text-sm">Columns: {active.schema.columns.join(" · ")}</p></div><button className="button button-primary" onClick={() => navigator.clipboard?.writeText(active.code).then(() => undefined).catch(() => undefined)}>Copy template code</button></div></section>}
  </section>;
}

function InvoiceTable({ invoices, onPreview, onPayment, allowPayment }: { invoices: Invoice[]; onPreview: (invoice: Invoice) => void; onPayment: (invoice: Invoice) => void; allowPayment: boolean }) {
  if (!invoices.length) return <div className="muted py-8 text-center text-sm">No invoices yet. Start your first checkout to see it here.</div>;
  return <div className="table-wrap"><table className="simple-table"><thead><tr className="table-row"><th>Invoice</th><th>Customer</th><th>Date</th><th>Amount</th><th>Payment</th><th></th></tr></thead><tbody>
    {invoices.map((invoice) => <tr className="table-row" key={invoice.id}>
      <td><button className="font-semibold text-[var(--accent)] hover:underline" onClick={() => onPreview(invoice)}>{invoice.number}</button><small className="muted block">{invoice.createdBy}</small></td>
      <td>{invoice.customerName}</td><td>{formatDate(invoice.issuedAt, true)}</td><td className="font-semibold">{money(invoice.grandTotal)}</td>
      <td><button className={`tag tag-${invoice.paymentStatus.toLowerCase()}`} onClick={() => allowPayment && onPayment(invoice)} title={allowPayment ? "Update payment received" : ""}>{invoice.paymentStatus}</button></td>
      <td><button className="button button-quiet !p-2" aria-label={`Preview ${invoice.number}`} onClick={() => onPreview(invoice)}><FileText size={16} /></button></td>
    </tr>)}
  </tbody></table></div>;
}

function InvoiceHistoryView({ invoices, search, setSearch, fromDate, setFromDate, toDate, setToDate, onPreview, onPayment }: {
  invoices: Invoice[]; search: string; setSearch: (value: string) => void; fromDate: string; setFromDate: (value: string) => void;
  toDate: string; setToDate: (value: string) => void; onPreview: (invoice: Invoice) => void; onPayment: (invoice: Invoice) => void;
}) {
  return <section className="space-y-5">
    <div><p className="eyebrow">Sales records</p><h2 className="mt-1 text-2xl font-bold">Invoice history</h2><p className="muted mt-1 text-sm">Filter by invoice date or customer. Your selection stays in place while you work.</p></div>
    <section className="panel content-card">
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
        <Field label="Search invoices"><input className="field" placeholder="Invoice, customer, payment..." value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field label="From date"><input className="field" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
        <Field label="To date"><input className="field" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
      </div>
      <InvoiceTable invoices={invoices} onPreview={onPreview} onPayment={onPayment} allowPayment />
    </section>
  </section>;
}

export function BillingApp() {
  return <ErrorBoundary><BillingAppInner /></ErrorBoundary>;
}
