import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("session refresh uses the resilient request client and validates its payload", async () => {
  const provider = await read("app/components/SessionProvider.tsx");

  assert.match(provider, /import \{ HttpError, requestJson \} from "@\/app\/lib\/http-client"/);
  assert.match(provider, /requestJson<Session>\("\/api\/session", \{ signal: controller\.signal, cache: "no-store" \}\)/);
  assert.doesNotMatch(provider, /\bfetch\s*\(/);
  assert.match(provider, /!value \|\| typeof value\.authenticated !== "boolean"/);
  assert.match(provider, /throw new HttpError\(200, "会话接口没有返回有效数据"\)/);
});

test("session refresh treats 401 as anonymous and every other failure as a safe gate", async () => {
  const provider = await read("app/components/SessionProvider.tsx");

  assert.match(provider, /if \(controller\.signal\.aborted\) return/);
  assert.match(provider, /error instanceof HttpError && error\.status === 401/);
  assert.match(provider, /error\.status === 401[\s\S]*setSession\(\{ authenticated: false \}\)[\s\S]*setSessionError\(false\)/);
  assert.match(provider, /setSession\(\{ authenticated: false \}\);\s*setSessionError\(true\)/);
  assert.match(provider, /setSession\(value\);\s*setSessionError\(false\)/);
});

test("session safety gate keeps both recovery links readable and touch-safe", async () => {
  const styles = await read("app/globals.css");

  assert.match(styles, /\.authGate \.primaryButton,\s*\.authGate \.gateLink\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /\.authGate \.primaryButton,\s*\.authGate \.gateLink\s*\{[^}]*font-size:\s*14px/);
});
