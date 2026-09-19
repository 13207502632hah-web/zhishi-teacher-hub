import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ocrOutput = join(root, "public", "ocr");
const ocrWorker = join(root, "node_modules", "tesseract.js", "dist", "worker.min.js");
const pdfOutput = join(root, "public", "pdfjs");
const pdfWorker = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");

await Promise.all([
  rm(ocrOutput, { recursive: true, force: true }),
  rm(pdfOutput, { recursive: true, force: true }),
]);
await Promise.all([mkdir(ocrOutput, { recursive: true }), mkdir(pdfOutput, { recursive: true })]);
await Promise.all([
  cp(ocrWorker, join(ocrOutput, "worker.min.js")),
  cp(pdfWorker, join(pdfOutput, "pdf.worker.min.mjs")),
]);
console.log("OCR and PDF assets prepared in public (generated, git-ignored).");
