import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { moduleCatalog, moduleStatusLabels } from "../src/module-catalog";

const catalog = {
  schemaVersion: 1,
  moduleCount: moduleCatalog.length,
  accuracyPolicy: "Catalog descriptions are repository-backed where known. Unspecified entries remain interactive catalog selectors but do not claim executable behavior.",
  modules: moduleCatalog.map((module) => ({
    id: module.id,
    title: module.title,
    domain: module.domain,
    button: {
      label: `Open module ${module.id}`,
      action: "select-module",
      enabled: true,
    },
    purpose: module.summary,
    specifications: {
      status: module.status,
      statusLabel: moduleStatusLabels[module.status],
      repositoryEvidence: module.evidence,
      nextValidation: module.nextValidation,
    },
  })),
};

async function main() {
  if (catalog.moduleCount !== 1400) throw new Error(`Expected 1400 modules, got ${catalog.moduleCount}`);
  await writeFile(resolve(process.cwd(), "modules-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});