import test from "node:test";
import assert from "node:assert/strict";
import { decryptField, decryptTenant, encryptField } from "../src/server/field-encryption";

const key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

test("encrypts and decrypts field values with the configured AES key", () => {
  process.env.DATA_ENCRYPTION_KEY = key;
  const encrypted = encryptField("Customer name");

  assert.notEqual(encrypted, "Customer name");
  assert.match(encrypted, /^enc:v1:/);
  assert.equal(decryptField(encrypted), "Customer name");
});

test("preserves empty and legacy plaintext values", () => {
  process.env.DATA_ENCRYPTION_KEY = key;
  assert.equal(encryptField(""), "");
  assert.equal(decryptField("Legacy value"), "Legacy value");
});

test("encrypts user values that resemble the storage envelope prefix", () => {
  process.env.DATA_ENCRYPTION_KEY = key;
  const value = "enc:v1:not-an-envelope";
  const encrypted = encryptField(value);

  assert.notEqual(encrypted, value);
  assert.equal(decryptField(encrypted), value);
});

test("fails explicitly when the encryption key is invalid or does not match", () => {
  process.env.DATA_ENCRYPTION_KEY = key;
  const encrypted = encryptField("Sensitive value");
  process.env.DATA_ENCRYPTION_KEY = "f1e0d1c2b3a495867768594a3b2c1d0e0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  assert.throws(() => decryptField(encrypted));
  process.env.DATA_ENCRYPTION_KEY = "too-short";
  assert.throws(() => encryptField("Another value"), /exactly 32 random bytes/);
  assert.throws(() => decryptField(encrypted), /exactly 32 random bytes/);
});

test("decrypts tenant business fields while preserving configuration fields", () => {
  process.env.DATA_ENCRYPTION_KEY = key;
  const tenant = {
    name: encryptField("Store"),
    legalName: encryptField("Store Limited"),
    gstin: encryptField("33ABCDE1234F1Z5"),
    upiId: encryptField("store@upi"),
    stateCode: "33",
  };

  assert.deepEqual(decryptTenant(tenant), {
    name: "Store",
    legalName: "Store Limited",
    gstin: "33ABCDE1234F1Z5",
    upiId: "store@upi",
    stateCode: "33",
  });
});
