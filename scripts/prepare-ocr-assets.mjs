import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "public", "ocr");
const worker = join(root, "node_modules", "tesseract.js", "dist", "worker.min.js");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(worker, join(output, "worker.min.js"));
console.log("OCR assets prepared in public/ocr (generated, git-ignored).");
