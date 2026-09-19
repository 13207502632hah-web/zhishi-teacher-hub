type EncodedFile = { name?: unknown; type?: unknown; base64?: unknown };
type EncodedQuestionImport = { name?: unknown; file?: EncodedFile; answerFile?: EncodedFile };

const maxBase64Length = Math.ceil(20 * 1024 * 1024 / 3) * 4 + 8;

function decodeFile(value: EncodedFile | undefined, label: string) {
  const name = String(value?.name || "").trim();
  const type = String(value?.type || "application/octet-stream").trim() || "application/octet-stream";
  const base64 = String(value?.base64 || "").trim();
  if (!name || !base64) throw new Error(`缺少${label}文件`);
  if (base64.length > maxBase64Length) throw new Error(`${label}文件须不超过 20MB`);
  let binary = "";
  try { binary = atob(base64); } catch { throw new Error(`${label}文件编码无效`); }
  if (!binary.length || binary.length > 20 * 1024 * 1024) throw new Error(`${label}文件须非空且不超过 20MB`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
}

export async function readQuestionImportForm(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("题库导入请求格式无效，请刷新页面后重试");
  }
  const payload = await request.json() as EncodedQuestionImport;
  const form = new FormData(), file = decodeFile(payload.file, "题卷");
  form.set("file", file);
  if (payload.answerFile?.base64) form.set("answerFile", decodeFile(payload.answerFile, "答案"));
  const name = String(payload.name || "").trim();
  if (name) form.set("name", name);
  return form;
}
