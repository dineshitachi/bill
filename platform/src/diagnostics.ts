export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[token]")
    .replace(/([?&](?:access_token|refresh_token|token|api_key|key|password|secret)=)[^&\s]*/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\+?91[ -]?)?[6-9]\d{9}\b/g, "[phone]")
    .replace(/\b\d{12}\b/g, "[numeric-id]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}