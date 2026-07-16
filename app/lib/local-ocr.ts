export type OcrProgress = { status: string; progress: number };

export async function recognizeChineseImage(file: File, onProgress?: (progress: OcrProgress) => void) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("chi_sim", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/tesseract-core-lstm.wasm.js",
    langPath: "/ocr",
    logger: (event) => onProgress?.({ status: event.status, progress: event.progress || 0 }),
  });
  try {
    const result = await worker.recognize(file);
    return { text: result.data.text.trim(), confidence: Math.max(0, Math.min(1, result.data.confidence / 100)) };
  } finally {
    await worker.terminate();
  }
}
