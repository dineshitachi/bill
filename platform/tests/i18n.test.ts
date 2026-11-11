import assert from "node:assert/strict";
import test from "node:test";
import { languageOptions, translate, translationKeys } from "../src/i18n";

test("all supported languages provide the core workspace and AGI labels", () => {
  assert.deepEqual(languageOptions.map(({ code }) => code), [
    "en", "ta", "hi", "te", "kn", "ml", "bn", "mr", "gu", "pa",
  ]);
  for (const { code, locale, label } of languageOptions) {
    assert.ok(locale.endsWith("-IN"));
    assert.ok(label.length > 0);
    for (const key of translationKeys) assert.ok(translate(code, key).trim().length > 0, `${code}:${key}`);
  }
});
