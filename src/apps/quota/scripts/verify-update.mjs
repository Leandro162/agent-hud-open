// Independent release-time verification. Runtime verification is performed by
// the Tauri updater plugin with the same embedded public key.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyUpdate(
  bytes,
  encodedSignature,
  encodedPublicKey,
  version,
) {
  const keyLines = Buffer.from(encodedPublicKey.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const signatureLines = Buffer.from(encodedSignature.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const key = Buffer.from(keyLines[1] ?? "", "base64");
  const sig = Buffer.from(signatureLines[1] ?? "", "base64");
  const commentLine = signatureLines[2] ?? "";
  if (
    key.length !== 42 ||
    sig.length !== 74 ||
    !commentLine.startsWith("trusted comment: ")
  )
    throw Error("Malformed update signature");
  if (!key.subarray(2, 10).equals(sig.subarray(2, 10)))
    throw Error("Wrong update signing key");
  const algorithm = sig.subarray(0, 2).toString("ascii");
  if (algorithm !== "ED" && algorithm !== "Ed")
    throw Error("Unsupported signing algorithm");
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      key.subarray(10),
    ]),
    format: "der",
    type: "spki",
  });
  const payload =
    algorithm === "ED"
      ? createHash("blake2b512").update(bytes).digest()
      : bytes;
  const signature = sig.subarray(10);
  if (!verify(null, payload, publicKey, signature))
    throw Error("Update package signature failed");
  const comment = commentLine.slice(17);
  const globalSignature = Buffer.from(signatureLines[3] ?? "", "base64");
  if (
    !verify(
      null,
      Buffer.concat([signature, Buffer.from(comment)]),
      publicKey,
      globalSignature,
    )
  )
    throw Error("Update version signature failed");
  if (!comment.split("\t").includes(`version:${version}`))
    throw Error("Signed version does not match update version");
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [artifact, signature, publicKey, version] = process.argv.slice(2);
  verifyUpdate(
    readFileSync(artifact),
    readFileSync(signature, "utf8"),
    readFileSync(publicKey, "utf8"),
    version,
  );
  console.log(`Verified package signature and bound version ${version}.`);
}
