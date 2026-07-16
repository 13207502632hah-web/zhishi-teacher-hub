export function aiBoolean(value: unknown, fallback = false) {
  if (value == null) return fallback;
  return value === true || value === 1 || value === "1";
}
