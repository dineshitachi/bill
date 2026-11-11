import { sanitizeDiagnosticText } from "@/diagnostics";

type Recovery = { target: HTMLElement; handlerKey: string | null };
type FallbackHandler = () => void | Promise<void>;

const fallbacks = new Map<string, FallbackHandler>();
let started = false;
let lastAction: Recovery | null = null;
let observer: MutationObserver | undefined;

export function registerFallback(key: string, handler: FallbackHandler): () => void {
  fallbacks.set(key, handler);
  return () => fallbacks.delete(key);
}

function fingerprint(name: string, message: string, route: string): string {
  let hash = 2166136261;
  for (const char of `${name}|${message}|${route}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function report(name: string, message: string): void {
  const safeMessage = sanitizeDiagnosticText(message);
  const safeName = sanitizeDiagnosticText(name).slice(0, 100) || "RuntimeError";
  const route = sanitizeDiagnosticText(window.location.pathname).slice(0, 200);
  void fetch("/api/telemetry/errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint: fingerprint(safeName, safeMessage, route), name: safeName, message: safeMessage, route }),
    keepalive: true,
  }).catch(() => undefined);
}

export function reportClientError(name: string, message: string): void {
  if (typeof window !== "undefined") report(name, message);
}

function recoverAction(): void {
  const recovery = lastAction;
  if (!recovery) return;
  const { target, handlerKey } = recovery;
  target.removeAttribute("aria-busy");
  target.removeAttribute("data-loading");
  if ("disabled" in target && typeof target.disabled === "boolean") target.disabled = false;
  target.classList.remove("is-loading");
  if (handlerKey) {
    const handler = fallbacks.get(handlerKey);
    if (handler) void Promise.resolve(handler()).catch((error: unknown) => {
      report("RecoveryFallbackError", error instanceof Error ? error.message : "Fallback failed");
    });
  }
}

export function startSelfHealingAgent(): () => void {
  if (started || typeof window === "undefined") return () => undefined;
  started = true;

  const rememberAction = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLElement>("[data-resilient-action]");
    if (!action) return;
    lastAction = { target: action, handlerKey: action.dataset.safeFallback || null };
  };
  const onError = (event: ErrorEvent) => {
    report(event.error?.name || "RuntimeError", event.message || "UI action failed");
    recoverAction();
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    report(reason instanceof Error ? reason.name : "UnhandledRejection", reason instanceof Error ? reason.message : String(reason));
    recoverAction();
  };

  document.addEventListener("click", rememberAction, true);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  observer = new MutationObserver(() => {
    if (lastAction && !lastAction.target.isConnected) lastAction = null;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    document.removeEventListener("click", rememberAction, true);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    observer?.disconnect();
    observer = undefined;
    started = false;
  };
}