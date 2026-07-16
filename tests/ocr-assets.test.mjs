import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import test from "node:test";

const ocrDirectory = new URL("../public/ocr/", import.meta.url);
const expectedFiles = [
  "chi_sim.traineddata.gz",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "worker.min.js",
];

test("browser OCR assets keep every runtime-selected LSTM core without unused duplicate binaries", async () => {
  const files = (await readdir(ocrDirectory)).sort();
  assert.deepEqual(files, expectedFiles);
  for (const name of expectedFiles) assert.ok((await stat(new URL(name, ocrDirectory))).size > 0, `${name} must not be empty`);
});
