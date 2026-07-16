import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const ocrDirectory = new URL("../public/ocr/", import.meta.url);
const expectedFiles = ["worker.min.js"];

test("browser OCR keeps a local worker while Tesseract loads compatible version-pinned runtime data", async () => {
  const files = (await readdir(ocrDirectory)).sort();
  assert.deepEqual(files, expectedFiles);
  for (const name of expectedFiles) assert.ok((await stat(new URL(name, ocrDirectory))).size > 0, `${name} must not be empty`);
  const client = await readFile(new URL("../app/lib/local-ocr.ts", import.meta.url), "utf8");
  assert.match(client, /createWorker\("chi_sim",\s*1/);
  assert.match(client, /workerPath:\s*"\/ocr\/worker\.min\.js"/);
  assert.doesNotMatch(client, /corePath|langPath/);
});
