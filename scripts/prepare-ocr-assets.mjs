import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "public", "ocr");
const worker = join(root, "node_modules", "tesseract.js", "dist", "worker.min.js");
const core = join(root, "node_modules", "tesseract.js-core");
const language = join(root, "node_modules", "@tesseract.js-data", "chi_sim", "4.0.0", "chi_sim.traineddata.gz");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(worker, join(output, "worker.min.js"));
await cp(language, join(output, "chi_sim.traineddata.gz"));
for (const name of await readdir(core)) {
  if (/^tesseract-core.*lstm.*\.(js|wasm)$/.test(name)) await cp(join(core, name), join(output, name));
}
console.log("OCR assets prepared in public/ocr (generated, git-ignored).");
