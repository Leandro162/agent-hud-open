import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [unbundled, installed] = process.argv.slice(2);
const expected = readFileSync(unbundled);
// tauri-bundler patches this marker before embedding the EXE in NSIS, then
// restores the unbundled file. Compare every byte after the documented patch.
const token = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
const index = expected.indexOf(token);
assert.ok(index >= 0, "Missing original Tauri bundle marker");
Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS").copy(expected, index);
assert.ok(
  expected.equals(readFileSync(installed)),
  "Installed file differs from the expected NSIS-patched executable",
);
console.log(
  "Verified all installed executable bytes, including the NSIS bundle marker.",
);
