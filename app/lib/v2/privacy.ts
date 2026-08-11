const privateKeyPattern = /^(?:name|fullName|displayName|studentName|studentId|studentIds|userId|accountId|guardianName|guardianUserId|guardianContact|contact|phone|mobile|wechat|wechatId|openId|unionId|email|address|token|session|password|secret|cookie|credential)$/i;
const phonePattern = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type PrivacyReport = { redactedFields: string[]; replacements: number };

export function anonymizeForAi(value: unknown, knownNames: string[] = []) {
  const report: PrivacyReport = { redactedFields: [], replacements: 0 };
  const nameMap = new Map(knownNames.filter(Boolean).map((name, index) => [name, `学生${String(index + 1).padStart(2, "0")}`]));

  const redactText = (input: unknown) => {
    let text = String(input ?? "");
    for (const [name, alias] of nameMap) {
      if (!name || !text.includes(name)) continue;
      const count = text.split(name).length - 1;
      text = text.split(name).join(alias);
      report.replacements += count;
    }
    text = text.replace(phonePattern, () => { report.replacements++; return "[手机号已脱敏]"; });
    text = text.replace(emailPattern, () => { report.replacements++; return "[邮箱已脱敏]"; });
    return text;
  };

  const walk = (input: unknown, path = "root"): unknown => {
    if (input == null || typeof input === "boolean" || typeof input === "number") return input;
    if (typeof input === "string") return redactText(input);
    if (Array.isArray(input)) return input.map((item, index) => walk(item, `${path}[${index}]`));
    if (typeof input !== "object") return redactText(input);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (privateKeyPattern.test(key)) {
        output[key] = "[敏感字段已移除]";
        report.redactedFields.push(`${path}.${key}`);
        continue;
      }
      output[key] = walk(item, `${path}.${key}`);
    }
    return output;
  };

  return { value: walk(value), report };
}

export function safeInputSummary(value: unknown) {
  const serialized = JSON.stringify(anonymizeForAi(value).value);
  return serialized.length > 320 ? `${serialized.slice(0, 317)}...` : serialized;
}
