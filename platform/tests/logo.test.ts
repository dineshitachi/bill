import assert from "node:assert/strict";
import test from "node:test";
import { isCompanyLogoDataUrl, MAX_LOGO_DATA_URL_LENGTH } from "../src/logo";

test("company logo data URLs accept supported raster formats only", () => {
  assert.equal(isCompanyLogoDataUrl("data:image/png;base64,AAAA"), true);
  assert.equal(isCompanyLogoDataUrl("data:image/jpeg;base64,AAAA"), true);
  assert.equal(isCompanyLogoDataUrl("data:image/webp;base64,AAAA"), true);
  assert.equal(isCompanyLogoDataUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isCompanyLogoDataUrl("https://example.test/logo.webp"), false);
  assert.equal(isCompanyLogoDataUrl("data:image/webp;base64,not base64"), false);
  assert.equal(isCompanyLogoDataUrl(`data:image/webp;base64,${"A".repeat(MAX_LOGO_DATA_URL_LENGTH)}`), false);
});
