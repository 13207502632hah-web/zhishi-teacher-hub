import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const ocrDirectory = new URL("../public/ocr/", import.meta.url);
const expectedFiles = [
  "chi_sim.traineddata.gz",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "worker.min.js",
];

test("browser OCR assets keep runtime-selected LSTM cores and the compact Chinese model", async () => {
  const files = (await readdir(ocrDirectory)).sort();
  assert.deepEqual(files, expectedFiles);
  for (const name of expectedFiles) assert.ok((await stat(new URL(name, ocrDirectory))).size > 0, `${name} must not be empty`);
  assert.ok((await stat(new URL("chi_sim.traineddata.gz", ocrDirectory))).size < 5_000_000, "Chinese model should remain deployable");
  const client = await readFile(new URL("../app/lib/local-ocr.ts", import.meta.url), "utf8");
  assert.match(client, /corePath:\s*"\/ocr"/);
  const preparer = await readFile(new URL("../scripts/prepare-ocr-assets.mjs", import.meta.url), "utf8");
  assert.match(preparer, /4\.0\.0_best_int/);
});
