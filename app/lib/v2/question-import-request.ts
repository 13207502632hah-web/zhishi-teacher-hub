type EncodedFile = { name?: unknown; type?: unknown; base64?: unknown };
type EncodedQuestionImport = { name?: unknown; file?: EncodedFile; answerFile?: EncodedFile; pages?: EncodedFile[]; answerPages?: EncodedFile[] };

const maxBase64Length = Math.ceil(20 * 1024 * 1024 / 3) * 4 + 8;
const maxPageBase64Length = Math.ceil(4 * 1024 * 1024 / 3) * 4 + 8;

function decodeFile(value: EncodedFile | undefined, label: string, maximumBytes = 20 * 1024 * 1024) {
  const name = String(value?.name || "").trim();
  const type = String(value?.type || "application/octet-stream").trim() || "application/octet-stream";
  const base64 = String(value?.base64 || "").trim();
  if (!name || !base64) throw new Error(`缺少${label}文件`);
  if (base64.length > (maximumBytes === 20 * 1024 * 1024 ? maxBase64Length : maxPageBase64Length)) throw new Error(`${label}文件过大`);
  let binary = "";
  try { binary = atob(base64); } catch { throw new Error(`${label}文件编码无效`); }
  if (!binary.length || binary.length > maximumBytes) throw new Error(`${label}文件须非空且不超过 ${Math.floor(maximumBytes / 1024 / 1024)}MB`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
}

function appendPages(form: FormData, values: EncodedFile[] | undefined, field: "page" | "answerPage", label: string) {
  if (!values) return;
  if (!Array.isArray(values) || values.length > 40) throw new Error(`${label}页数须不超过 40 页`);
  for (const [index, value] of values.entries()) {
    const file = decodeFile(value, `${label}第 ${index + 1} 页`, 4 * 1024 * 1024);
    if (!file.type.startsWith("image/")) throw new Error(`${label}页图格式无效`);
    form.append(field, file);
  }
}

export async function readQuestionImportForm(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("题库导入请求格式无效，请刷新页面后重试");
  }
  const payload = await request.json() as EncodedQuestionImport;
  const form = new FormData(), file = decodeFile(payload.file, "题卷");
  form.set("file", file);
  if (payload.answerFile?.base64) form.set("answerFile", decodeFile(payload.answerFile, "答案"));
  appendPages(form, payload.pages, "page", "题卷");
  appendPages(form, payload.answerPages, "answerPage", "答案");
  const name = String(payload.name || "").trim();
  if (name) form.set("name", name);
  return form;
}
