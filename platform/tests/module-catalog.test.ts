import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getVirtualRowWindow } from "../src/components/module-grid-engine";
import { getModuleDomain, moduleCatalog, moduleDomains, moduleStatusLabels, resolveSelectedModule } from "../src/module-catalog";

const generatedCatalog = JSON.parse(readFileSync(new URL("../modules-catalog.json", import.meta.url), "utf8")) as {
  moduleCount: number;
  modules: Array<{
    id: number;
    purpose: string;
    button: { action: string; enabled: boolean };
    specifications: { status: string; repositoryEvidence: string; nextValidation: string };
  }>;
};

test("module catalog contains every requested ID exactly once", () => {
  assert.equal(moduleCatalog.length, 1400);
  assert.deepEqual(moduleCatalog.map((module) => module.id), Array.from({ length: 1400 }, (_, index) => index + 1));
  assert.equal(new Set(moduleCatalog.map((module) => module.id)).size, 1400);
});

test("every module has a domain, operational summary, evidence, and known status", () => {
  for (const module of moduleCatalog) {
    assert.ok(module.title.trim(), `Module ${module.id} title`);
    assert.ok(module.domain.trim(), `Module ${module.id} domain`);
    assert.ok(module.summary.trim(), `Module ${module.id} summary`);
    assert.ok(module.evidence.trim(), `Module ${module.id} evidence`);
    assert.ok(module.nextValidation.trim(), `Module ${module.id} validation`);
    assert.ok(module.status in moduleStatusLabels, `Module ${module.id} status`);
  }
  assert.ok(moduleDomains.length >= 10);
  assert.deepEqual([...new Set(moduleDomains)], moduleDomains);
  assert.ok(moduleCatalog.every((module) => module.domain === getModuleDomain(module.id)));
  assert.ok(moduleCatalog.slice(1034).every((module) => module.status === "needs-spec"));
});

test("unspecified modules are explicitly marked instead of receiving invented feature claims", () => {
  const unspecified = moduleCatalog.filter((module) => module.status === "needs-spec");
  assert.ok(unspecified.length > 0);
  for (const module of unspecified) {
    assert.match(module.title, /catalog entry needed/);
    assert.match(module.summary, /exact operational description has not been normalized/);
    assert.match(module.evidence, /No module-specific implementation evidence/);
    assert.match(module.nextValidation, /Normalize the requirement/);
  }
});

test("selected module resolution never leaks a module outside the active results", () => {
  const filtered = moduleCatalog.filter((module) => module.domain === "Core Billing & Platform");
  assert.equal(resolveSelectedModule(filtered, 1)?.id, 1);
  assert.equal(resolveSelectedModule(filtered, 41), null);
  assert.equal(resolveSelectedModule([], 1), null);
});

test("known implementation states are not presented as fully verified", () => {
  assert.equal(moduleCatalog[40].status, "implemented");
  assert.equal(moduleCatalog[101].status, "provider");
  assert.equal(moduleCatalog[200].status, "implemented");
  assert.equal(moduleCatalog[300].status, "implemented");
  assert.equal(moduleCatalog[700].status, "partial");
  assert.equal(moduleCatalog[1033].status, "needs-spec");
});

test("generated JSON defines one selectable button and complete specification fields per module", () => {
  assert.equal(generatedCatalog.moduleCount, 1400);
  assert.equal(generatedCatalog.modules.length, 1400);
  for (const module of generatedCatalog.modules) {
    assert.ok(module.button.enabled, `Module ${module.id} button`);
    assert.equal(module.button.action, "select-module");
    assert.ok(module.purpose.trim(), `Module ${module.id} purpose`);
    assert.ok(module.specifications.status.trim(), `Module ${module.id} status`);
    assert.ok(module.specifications.repositoryEvidence.trim(), `Module ${module.id} evidence`);
    assert.ok(module.specifications.nextValidation.trim(), `Module ${module.id} validation`);
  }
});

test("virtualized module grid includes visible rows and bounded overscan", () => {
  assert.deepEqual(getVirtualRowWindow(100, 0, 224), { first: 0, last: 6 });
  assert.deepEqual(getVirtualRowWindow(100, 1120, 224), { first: 6, last: 16 });
  assert.deepEqual(getVirtualRowWindow(3, 0, 224), { first: 0, last: 3 });
});