import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("portal exchanges only a live student or parent mini session for a signed HttpOnly cookie", async () => {
  const [auth, route] = await Promise.all([
    read("app/lib/portal-auth.ts"),
    read("app/api/portal/session/route.ts"),
  ]);

  assert.match(route, /requireMini\(request,\s*\["student",\s*"parent"\]\)/);
  assert.match(route, /createPortalSessionCookie/);
  assert.match(route, /Cache-Control["']?,\s*["']private, no-store/);
  assert.doesNotMatch(route, /searchParams|get\(["']token|body\.token/);

  assert.match(auth, /zhishi_portal_session/);
  assert.match(auth, /portal-session:/);
  assert.match(auth, /HMAC/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(auth, /mini_sessions/);
  assert.match(auth, /JOIN wechat_accounts/);
  assert.match(auth, /ms\.expires_at>CURRENT_TIMESTAMP/);
  assert.match(auth, /wa\.status='active'/);
  assert.match(auth, /wa\.role IN \('student','parent'\)/);
  assert.doesNotMatch(auth, /token_hash.*Cookie|Bearer.*Cookie/);
});

test("access resolves a portal principal from the live cookie without changing teacher precedence", async () => {
  const access = await read("app/lib/access.ts");

  assert.match(access, /if \(await getTeacherAdminSession\(\)\) return getTeacherAdminAccess\(\)/);
  assert.match(access, /getPortalAccess/);
  assert.match(access, /portalAccountId/);
  assert.match(access, /student:\s*\["portal:read",\s*"resources:read"\]/);
  assert.match(access, /parent:\s*\["portal:read",\s*"resources:read"\]/);
  assert.doesNotMatch(access, /authorization|Bearer/);
});

test("portal bootstrap consumes a URL fragment, clears it, and never stores the mini bearer token", async () => {
  const [page, shell, navigation] = await Promise.all([
    read("app/portal/page.tsx"),
    read("app/components/AppShell.tsx"),
    read("app/components/WorkspaceNavigation.tsx"),
  ]);

  assert.match(page, /window\.location\.hash/);
  assert.match(page, /mini_token/);
  assert.match(page, /history\.replaceState/);
  assert.match(page, /\/api\/portal\/session/);
  assert.match(page, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|searchParams\.get\(["']token/);
  assert.match(shell, /pathname === "\/portal"/);
  assert.match(shell, /微信小程序/);
  assert.match(navigation, /learner[\s\S]+\/api\/portal\/session/);
});

test("learner shell excludes teacher-only controls and portal keeps one main landmark", async () => {
  const [page, shell, navigation] = await Promise.all([
    read("app/portal/page.tsx"),
    read("app/components/AppShell.tsx"),
    read("app/components/WorkspaceNavigation.tsx"),
  ]);

  assert.match(shell, /const learnerSession = session\?\.role === "student" \|\| session\?\.role === "parent"/);
  assert.match(shell, /!learnerSession[\s\S]+commandTrigger/);
  assert.match(shell, /!learnerSession[\s\S]+教学待办/);
  assert.match(navigation, /learner \? "学生学习门户" : "政治教学工作台"/);
  assert.doesNotMatch(page, /<main className=\{styles\.contentGrid\}/);
});

test("portal data authorization follows confirmed mini bindings instead of assuming website user ids", async () => {
  const route = await read("app/api/portal/route.ts");

  assert.match(route, /portalAccountId/);
  assert.match(route, /mini_bindings/);
  assert.match(route, /mb\.status='active'/);
  assert.match(route, /wechat_accounts/);
  assert.match(route, /parent_student_links/);
  assert.doesNotMatch(route, /linkColumn|guardian_user_id/);
  assert.doesNotMatch(route, /studentId.*searchParams|searchParams.*studentId/);
  assert.doesNotMatch(route, /meta \? 403 : 404/);
  assert.match(route, /if \(!meta \|\| !allowed\)[\s\S]+status: 404/);
});

test("mini program opens the web portal with the token only in the URL fragment", async () => {
  const [appConfig, portalPage, webPage, webMarkup] = await Promise.all([
    read("mini-program/app.json"),
    read("mini-program/pages/portal/index.js"),
    read("mini-program/pages/web-portal/index.js"),
    read("mini-program/pages/web-portal/index.wxml"),
  ]);

  assert.match(appConfig, /pages\/web-portal\/index/);
  assert.match(portalPage, /openWebPortal/);
  assert.match(portalPage, /wx\.navigateTo/);
  assert.match(webPage, /#mini_token=/);
  assert.match(webPage, /globalData\.token/);
  assert.match(webMarkup, /<web-view\s+src="\{\{src\}\}"/);
  assert.doesNotMatch(portalPage, /\?[^"'`]*token=/);
  assert.doesNotMatch(webPage, /\?[^"'`]*token=/);
});
