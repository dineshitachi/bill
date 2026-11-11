import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const templates = require("../../billing-templates.js");

test("standalone billing template catalog has thirty distinct printable designs", () => {
  assert.equal(templates.length, 30);
  assert.equal(new Set(templates.map((template) => template.id)).size, 30);
  assert.equal(new Set(templates.map((template) => template.name)).size, 30);
  assert.equal(new Set(templates.map((template) => template.accent)).size, 30);
  assert.ok(templates.every((template) =>
    /^#[0-9a-f]{6}$/i.test(template.accent) &&
    /^#[0-9a-f]{6}$/i.test(template.surface) &&
    ["band", "classic", "minimal", "frame", "ledger", "split", "ribbon", "compact", "soft", "bold"].includes(template.layout) &&
    ["left", "center", "right"].includes(template.logoPlacement)
  ));
});

test("billing form exposes a separate blank design and loads the catalog", async () => {
  const html = await readFile(new URL("../../bill.html", import.meta.url), "utf8");
  assert.match(html, /<script src="billing-templates\.js"><\/script>/);
  assert.match(html, /id="invoice-template-gallery"/);
  assert.match(html, /id="invoice-template-id"[^>]*value="blank"/);
});
