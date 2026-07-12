export function passwordStrengthError(password: string) {
  if (password.length < 12) return "新密码至少需要 12 位";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "新密码需同时包含字母和数字";
  if (/^(.)\1+$/.test(password) || /123456|password|qwerty|111111|222222/i.test(password)) return "新密码过于简单，请避免连续数字或常见密码";
  return null;
}

export function safeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/workspace";
  try {
    const url = new URL(value, "https://teacher.local");
    return url.origin === "https://teacher.local" && !url.pathname.startsWith("/api/auth/") && url.pathname !== "/teacher-login"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/workspace";
  } catch {
    return "/workspace";
  }
}
