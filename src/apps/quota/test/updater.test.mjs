import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { verifyUpdate } from "../scripts/verify-update.mjs";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = randomBytes(8);
  const data = Buffer.from("Windows updater package fixture");
  const signature = sign(
    null,
    createHash("blake2b512").update(data).digest(),
    privateKey,
  );
  const comment = "timestamp:1792800000\tfile:setup.exe\tversion:0.2.0";
  const globalSignature = sign(
    null,
    Buffer.concat([signature, Buffer.from(comment)]),
    privateKey,
  );
  const key = Buffer.concat([
    Buffer.from("Ed"),
    keyId,
    publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ]);
  const sig = Buffer.concat([Buffer.from("ED"), keyId, signature]);
  const publicText = Buffer.from(
    `untrusted comment: test key\n${key.toString("base64")}\n`,
  ).toString("base64");
  const signatureText = `untrusted comment: test signature\n${sig.toString("base64")}\ntrusted comment: ${comment}\n${globalSignature.toString("base64")}\n`;
  return {
    data,
    publicText,
    signatureText,
    encoded: Buffer.from(signatureText).toString("base64"),
  };
}

test("release verification accepts an authentic version-bound update", () => {
  const f = fixture();
  assert.equal(verifyUpdate(f.data, f.encoded, f.publicText, "0.2.0"), true);
});

test("tampered package, wrong key and forged manifest version are rejected", () => {
  const f = fixture();
  assert.throws(() =>
    verifyUpdate(
      Buffer.concat([f.data, Buffer.from("tampered")]),
      f.encoded,
      f.publicText,
      "0.2.0",
    ),
  );
  assert.throws(() =>
    verifyUpdate(f.data, f.encoded, fixture().publicText, "0.2.0"),
  );
  assert.throws(() => verifyUpdate(f.data, f.encoded, f.publicText, "9.0.0"));
  const forged = Buffer.from(
    f.signatureText.replace("version:0.2.0", "version:9.0.0"),
  ).toString("base64");
  assert.throws(() => verifyUpdate(f.data, forged, f.publicText, "9.0.0"));
});
