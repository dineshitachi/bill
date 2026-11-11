import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createGateway } from "../server.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

test("gateway configures WAL, 64 MiB cache, and reports health metrics", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "billing-gateway-"));
  const gateway = createGateway({ databasePath: path.join(directory, "test.sqlite3"), upstreamUrl: "http://127.0.0.1:1" });
  try {
    const response = await gateway.app.inject({ method: "GET", url: "/health" });
    const health = response.json();
    assert.equal(response.statusCode, 200);
    assert.equal(health.gateway, "fastify");
    assert.equal(health.journalMode, "wal");
    assert.equal(health.cacheBytes, 64 * 1024 * 1024);
    assert.equal(health.integrity, "ok");
    assert.equal(typeof health.averageLatencyMs, "number");
    assert.equal(typeof health.activeClients, "number");
    assert.equal(gateway.db.pragma("cache_size", { simple: true }), -65536);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway proxies request bodies, status, and authentication cookies", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "billing-gateway-proxy-"));
  const legacy = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(401, { "content-type": "application/json", "set-cookie": "sid=test; HttpOnly; SameSite=Strict" });
      response.end(JSON.stringify({ error: "Username or password is incorrect.", received: Buffer.concat(chunks).toString("utf8") }));
    });
  });
  const port = await listen(legacy);
  const gateway = createGateway({ databasePath: path.join(directory, "test.sqlite3"), upstreamUrl: `http://127.0.0.1:${port}` });
  try {
    const payload = JSON.stringify({ username: "staff.user", password: "never-log-this" });
    const response = await gateway.app.inject({ method: "POST", url: "/api/auth/login", headers: { "content-type": "application/json" }, payload });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().received, payload);
    assert.match([].concat(response.headers["set-cookie"])[0], /^sid=test;/);
  } finally {
    await gateway.close();
    await new Promise((resolve) => legacy.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway rejects cross-origin requests and rate-limits sign-in generically", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "billing-gateway-security-"));
  let upstreamRequests = 0;
  const legacy = createServer((_request, response) => {
    upstreamRequests++;
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Username or password is incorrect." }));
  });
  const port = await listen(legacy);
  const gateway = createGateway({ databasePath: path.join(directory, "test.sqlite3"), upstreamUrl: `http://127.0.0.1:${port}` });
  try {
    const crossOrigin = await gateway.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, payload: "{}" });
    assert.equal(crossOrigin.statusCode, 403);
    assert.equal(upstreamRequests, 0);

    let response;
    for (let attempt = 0; attempt < 11; attempt++) {
      response = await gateway.app.inject({ method: "POST", url: "/api/auth/login", headers: { "content-type": "application/json" }, payload: "{}" });
    }
    assert.equal(response.statusCode, 429);
    assert.equal(response.json().error, "Sign-in failed. Check your username and password.");
    assert.equal(upstreamRequests, 10);
  } finally {
    await gateway.close();
    await new Promise((resolve) => legacy.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});