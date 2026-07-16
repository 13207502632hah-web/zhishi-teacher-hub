export function personInitial(value: unknown, fallback = "学") {
  const text = String(value ?? "")
    .trim()
    .replace(/^【演示】\s*/, "")
    .replace(/^[【\[(（\s]+/, "");
  return Array.from(text)[0] || fallback;
}

export function taskDueLabel(value: unknown, today: string) {
  const text = String(value ?? "").trim();
  if (!text) return "尽快处理";
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(text);
  if (!match) return text.replace("T", " ");
  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month}-${day}`;
  const time = hour && minute ? ` ${hour}:${minute}` : "";
  if (date === today.slice(0, 10)) return `今天${time}`;
  if (year === today.slice(0, 4)) return `${Number(month)}月${Number(day)}日${time}`;
  return `${year}年${Number(month)}月${Number(day)}日${time}`;
}
