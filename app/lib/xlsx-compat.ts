type ZipEntry = { name: string; flags: number; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

const utf8 = new TextDecoder();
const MAX_XML_BYTES = 20 * 1024 * 1024;

function findEndOfCentralDirectory(bytes: Uint8Array) {
  if (bytes.length < 22) throw new Error("XLSX 文件过短");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) if (view.getUint32(offset, true) === 0x06054b50) return offset;
  throw new Error("XLSX 缺少中央目录");
}

function listZipEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = findEndOfCentralDirectory(bytes);
  const count = view.getUint16(end + 10, true), centralOffset = view.getUint32(end + 16, true);
  if (count > 5000 || centralOffset >= bytes.length) throw new Error("XLSX 文件结构异常");
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error("XLSX 中央目录损坏");
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), compressedSize = view.getUint32(offset + 20, true), uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true), localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46, nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) throw new Error("XLSX 文件名记录损坏");
    entries.push({ name: utf8.decode(bytes.subarray(nameStart, nameEnd)), flags, method, compressedSize, uncompressedSize, localOffset });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(bytes: Uint8Array, entry: ZipEntry) {
  if ((entry.flags & 1) !== 0) throw new Error("不支持加密的 XLSX");
  if (entry.uncompressedSize > MAX_XML_BYTES) throw new Error("XLSX 工作表内容过大");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = entry.localOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) throw new Error("XLSX 本地文件头损坏");
  const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true), dataStart = offset + 30 + nameLength + extraLength, dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) throw new Error("XLSX 压缩内容不完整");
  const compressed = bytes.slice(dataStart, dataEnd);
  let output: ArrayBuffer;
  if (entry.method === 0) output = compressed.buffer;
  else if (entry.method === 8) output = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
  else throw new Error("XLSX 使用了不支持的压缩方式");
  if (output.byteLength > MAX_XML_BYTES) throw new Error("XLSX 解压后内容过大");
  if (entry.uncompressedSize && output.byteLength !== entry.uncompressedSize) throw new Error("XLSX 解压内容长度异常");
  return utf8.decode(output).replace(/^\uFEFF/, "");
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function sharedStringValues(xml: string) {
  const values: string[] = [];
  for (const item of xml.matchAll(/<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/gi)) values.push([...item[1].matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi)].map((match) => decodeXml(match[1])).join(""));
  return values;
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function worksheetXmlToTable(xml: string, sharedStrings: string[] = []) {
  const table: unknown[][] = [];
  for (const cell of xml.matchAll(/<(?:[\w.-]+:)?c\b(?![^>]*\/\s*>)([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?c>/gi)) {
    const reference = cell[1].match(/\br=["']([A-Z]+\d+)["']/i)?.[1];
    if (!reference) continue;
    const rowIndex = Number(reference.match(/\d+$/)?.[0] || 1) - 1, colIndex = columnIndex(reference), type = cell[1].match(/\bt=["']([^"']+)["']/i)?.[1] || "";
    const inline = [...cell[2].matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi)].map((match) => decodeXml(match[1])).join("");
    const raw = inline || decodeXml(cell[2].match(/<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/i)?.[1] || "");
    let value: unknown = raw;
    if (type === "s") value = sharedStrings[Number(raw)] ?? "";
    else if (!type && raw !== "" && Number.isFinite(Number(raw))) value = Number(raw);
    while (table.length <= rowIndex) table.push([]);
    while (table[rowIndex].length <= colIndex) table[rowIndex].push("");
    table[rowIndex][colIndex] = value;
  }
  return table;
}

/** ExcelJS 无法读取部分精简型或非标准命名空间 XLSX 时，仅提取首个工作表的单元格值。 */
export async function readFirstWorksheetCompat(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer), entries = listZipEntries(bytes);
  const sheet = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
  if (!sheet) throw new Error("XLSX 中没有可读取的工作表");
  const sharedEntry = entries.find((entry) => /^xl\/sharedStrings\.xml$/i.test(entry.name));
  const [sheetXml, sharedXml] = await Promise.all([readZipText(bytes, sheet), sharedEntry ? readZipText(bytes, sharedEntry) : Promise.resolve("")]);
  const table = worksheetXmlToTable(sheetXml, sharedXml ? sharedStringValues(sharedXml) : []);
  if (!table.some((row) => row.some((cell) => String(cell ?? "").trim()))) throw new Error("XLSX 首个工作表没有可导入内容");
  return table;
}
