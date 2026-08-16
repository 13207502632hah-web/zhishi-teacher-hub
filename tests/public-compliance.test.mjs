import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public compliance pages cover every supported client and essential policy topic", async () => {
  const [privacy, terms, deletion, support] = await Promise.all([
    read("app/privacy/page.tsx"),
    read("app/terms/page.tsx"),
    read("app/account-deletion/page.tsx"),
    read("app/support/page.tsx"),
  ]);

  for (const source of [privacy, terms, deletion, support]) {
    assert.match(source, /LegalPage/);
    assert.match(source, /2026 年 8 月 11 日/);
  }

  for (const client of ["网站", "iOS", "微信小程序"]) assert.match(privacy, new RegExp(client));
  for (const topic of ["学生姓名", "匿名化", "教师确认", "不出售", "未成年人", "删除"]) assert.match(privacy, new RegExp(topic));
  for (const topic of ["角色", "人工智能", "正式写入", "知识产权", "退出"]) assert.match(terms, new RegExp(topic));
  for (const topic of ["退出登录", "解除", "删除账号", "无法登录", "iOS"]) assert.match(deletion, new RegExp(topic));
  for (const topic of ["添加到主屏幕", "微信小程序", "同步失败", "数据为什么不同", "隐私政策"]) assert.match(support, new RegExp(topic));
});

test("compliance pages remain public and are discoverable from the shared shell", async () => {
  const [shell, notFound, layout, css] = await Promise.all([
    read("app/components/AppShell.tsx"),
    read("app/not-found.tsx"),
    read("app/legal/LegalPage.tsx"),
    read("app/legal/legal.module.css"),
  ]);

  for (const route of ["/privacy", "/terms", "/account-deletion", "/support"]) {
    assert.match(shell, new RegExp(route.replace("/", "\\/")));
    assert.match(notFound, new RegExp(route.replace("/", "\\/")));
    assert.match(layout, new RegExp(route.replace("/", "\\/")));
  }

  assert.match(layout, /aria-label/);
  assert.match(layout, /id="main-content"|AppShell/);
  assert.match(css, /min-height:\s*2\.75rem/);
  assert.match(css, /@media\s*\(min-width:\s*56rem\)/);
  assert.doesNotMatch(css, /width:\s*\d{4,}px/);
});
