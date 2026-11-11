import Fastify from "fastify";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdir, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(directory, "..");
const cacheBytes = 64 * 1024 * 1024;
const schemaVersion = "0.1.0";
const maxRequestBytes = 12 * 1024 * 1024;

export function configureDatabase(databasePath) {
  const db = new Database(databasePath, { timeout: 5000 });
  db.pragma("busy_timeout = 5000");
  let journalMode = "unknown";
  try { journalMode = db.pragma("journal_mode = WAL", { simple: true }); }
  catch { journalMode = db.pragma("journal_mode", { simple: true }); }
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -65536");
  db.pragma("wal_autocheckpoint = 1000");
  db.exec("CREATE TABLE IF NOT EXISTS local_api_schema_migrations (version TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)");
  db.prepare("INSERT OR IGNORE INTO local_api_schema_migrations (version, appliedAt) VALUES (?, ?)").run(schemaVersion, new Date().toISOString());
  return { db, journalMode };
}

function getFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForLegacyServer(child, port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = async () => {
      if (child.exitCode !== null) return reject(new Error(`Legacy billing server exited with code ${child.exitCode}`));
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(700) });
        if (response.ok) return resolve();
      } catch { }
      if (Date.now() >= deadline) return reject(new Error("Legacy billing server did not become ready"));
      setTimeout(poll, 200);
    };
    void poll();
  });
}

function safeResponseHeaders(headers) {
  const blocked = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase()) && headers[name] !== undefined));
}

function appendLatency(samples, duration) {
  samples.push(duration);
  if (samples.length > 256) samples.shift();
}

export function createGateway({ databasePath, upstreamUrl, httpsConfig } = {}) {
  const { db, journalMode } = configureDatabase(databasePath || path.join(workspaceRoot, "billing.sqlite3"));
  const latencySamples = [];
  const authAttempts = new Map();
  const backupDirectory = path.join(workspaceRoot, "local-api", "backups");
  const serverOptions = httpsConfig ? { http2: true, https: httpsConfig } : {};
  const app = Fastify({ logger: { level: "warn" }, bodyLimit: maxRequestBytes, ...serverOptions });
  let activeRequests = 0;
  let lastCheckpointAt = null;
  let lastIntegrityAt = null;
  let lastIntegrity = "not-run";

  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: maxRequestBytes }, (_request, body, done) => done(null, body));
  app.addHook("onRequest", async (request) => {
    request.gatewayStartedAt = performance.now();
    activeRequests++;
    if (request.headers.origin) {
      try {
        const origin = new URL(request.headers.origin);
        const host = request.headers.host || request.headers[":authority"];
        if (!host || origin.host.toLowerCase() !== host.toLowerCase()) request.gatewayOriginRejected = true;
      } catch { request.gatewayOriginRejected = true; }
    }
  });
  app.addHook("preHandler", async (request, reply) => {
    if (request.gatewayOriginRejected) return reply.code(403).send({ error: "Origin is not allowed" });
    if (request.raw.url?.split("?", 1)[0] !== "/api/auth/login") return;
    const now = Date.now();
    const key = request.ip;
    const current = authAttempts.get(key);
    if (!current || now - current.startedAt >= 60000) {
      authAttempts.set(key, { startedAt: now, count: 1 });
      return;
    }
    current.count++;
    if (current.count > 10) {
      reply.header("Retry-After", "60");
      return reply.code(429).send({ error: "Sign-in failed. Check your username and password." });
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
    reply.header("Content-Security-Policy", "default-src 'self' https: data: blob: 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (httpsConfig) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return payload;
  });
  app.addHook("onResponse", async (request) => {
    activeRequests = Math.max(0, activeRequests - 1);
    appendLatency(latencySamples, performance.now() - request.gatewayStartedAt);
  });

  const healthHandler = async () => {
    const sorted = [...latencySamples].sort((a, b) => a - b);
    const averageLatencyMs = latencySamples.length ? latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length : 0;
    const p95LatencyMs = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
    return {
      status: journalMode === "wal" && lastIntegrity !== "failed" ? "ok" : "degraded",
      storage: "sqlite",
      gateway: "fastify",
      journalMode,
      cacheBytes,
      schemaVersion,
      activeClients: activeRequests,
      averageLatencyMs: Number(averageLatencyMs.toFixed(2)),
      p95LatencyMs: Number(p95LatencyMs.toFixed(2)),
      lastCheckpointAt,
      lastIntegrityAt,
      integrity: lastIntegrity,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  };
  app.get("/health", healthHandler);

  const proxyHandler = async (request, reply) => {
    if (!upstreamUrl) return reply.code(503).send({ error: "Legacy API is not configured" });
    const destination = new URL(request.raw.url || "/", upstreamUrl);
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !name.startsWith(":")));
    Object.assign(headers, { host: destination.host, connection: "close", "x-forwarded-for": request.ip });
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    return new Promise((resolve) => {
      const proxy = httpRequest({ hostname: destination.hostname, port: destination.port, path: destination.pathname + destination.search, method: request.method, headers }, (response) => {
        reply.code(response.statusCode || 502);
        for (const [name, value] of Object.entries(safeResponseHeaders(response.headers))) reply.header(name, value);
        resolve(reply.send(response));
      });
      proxy.setTimeout(30000, () => proxy.destroy(new Error("Legacy API timeout")));
      proxy.on("error", (error) => {
        request.log.error({ err: error }, "Legacy API proxy failed");
        if (!reply.sent) resolve(reply.code(502).send({ error: "Billing service temporarily unavailable" }));
        else resolve();
      });
      const body = request.body;
      if (Buffer.isBuffer(body) && body.length) proxy.write(body);
      proxy.end();
    });
  };
  app.all("/", proxyHandler);
  app.all("/*", proxyHandler);

  const checkpointTimer = setInterval(() => {
    try { db.pragma("wal_checkpoint(PASSIVE)"); lastCheckpointAt = new Date().toISOString(); }
    catch (error) { app.log.error({ err: error }, "WAL checkpoint failed"); }
  }, 30000);
  checkpointTimer.unref();

  const integrityTimer = setInterval(() => {
    try {
      const result = db.pragma("integrity_check", { simple: true });
      lastIntegrity = result === "ok" ? "ok" : "failed";
      lastIntegrityAt = new Date().toISOString();
    } catch (error) {
      lastIntegrity = "failed";
      lastIntegrityAt = new Date().toISOString();
      app.log.error({ err: error }, "SQLite integrity check failed");
    }
  }, 6 * 60 * 60 * 1000);
  integrityTimer.unref();

  const backupTimer = setInterval(async () => {
    try {
      await mkdir(backupDirectory, { recursive: true });
      const destination = path.join(backupDirectory, `billing-${new Date().toISOString().replaceAll(":", "-")}.sqlite3`);
      await db.backup(destination);
      const backups = (await readdir(backupDirectory)).filter((name) => name.endsWith(".sqlite3")).sort().reverse();
      for (const oldBackup of backups.slice(7)) await import("node:fs/promises").then(({ unlink }) => unlink(path.join(backupDirectory, oldBackup)));
    } catch (error) { app.log.error({ err: error }, "Online SQLite backup failed"); }
  }, 6 * 60 * 60 * 1000);
  backupTimer.unref();

  const startupCheck = db.pragma("quick_check", { simple: true });
  lastIntegrity = startupCheck === "ok" ? "ok" : "failed";
  lastIntegrityAt = new Date().toISOString();

  return {
    app,
    db,
    async close() {
      clearInterval(checkpointTimer);
      clearInterval(integrityTimer);
      clearInterval(backupTimer);
      await app.close();
      try { db.pragma("wal_checkpoint(TRUNCATE)"); } finally { db.close(); }
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 8766);
  const databasePath = process.env.BILLING_DB_PATH || path.join(workspaceRoot, "billing.sqlite3");
  const legacyPort = await getFreeLoopbackPort();
  const httpsConfig = process.env.BILLING_TLS_KEY && process.env.BILLING_TLS_CERT
    ? { key: readFileSync(process.env.BILLING_TLS_KEY), cert: readFileSync(process.env.BILLING_TLS_CERT) }
    : undefined;
  const gateway = createGateway({ databasePath, upstreamUrl: `http://127.0.0.1:${legacyPort}`, httpsConfig });
  const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const shellArgs = process.platform === "win32"
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(workspaceRoot, "server.ps1"), "-Port", String(legacyPort)]
    : ["-NoProfile", "-File", path.join(workspaceRoot, "server.ps1"), "-Port", String(legacyPort)];
  const child = spawn(shell, shellArgs, { cwd: workspaceRoot, windowsHide: true, stdio: "ignore" });
  child.on("error", (error) => console.error("Unable to start legacy API", error));
  try {
    await waitForLegacyServer(child, legacyPort);
    await gateway.app.listen({ host: "127.0.0.1", port });
    console.log(`Billing gateway ready at ${httpsConfig ? "https" : "http"}://127.0.0.1:${port}/`);
  } catch (error) {
    child.kill();
    await gateway.close();
    throw error;
  }
  const shutdown = async () => {
    child.kill();
    await gateway.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("uncaughtException", (error) => { console.error(error); void shutdown(); });
  process.once("unhandledRejection", (error) => { console.error(error); void shutdown(); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}