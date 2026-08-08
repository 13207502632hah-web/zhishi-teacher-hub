# Sprint P1.1 班级分页与 ClassPicker 报告

## 目标

`/api/classes` 增加分页与搜索，使 4300 班级的默认载荷下降至少 80%，同时保证所有班级可通过分页或搜索到达；各页面班级下拉改为 ClassPicker，使用有界 `/api/classes/options`，停止全量班级加载。

## 实现

- `/api/classes`：默认 `pageSize=50`，支持 `page`、`pageSize`、`q`，返回 `total/page/pageCount/classes`。
- `/api/classes/options`：支持 `q` 与 `ids`，返回有界 options；`ids` 用于回填已选但不在当前 options 的班级。
- ClassPicker：替换各页面全量班级 `<select>`/下拉，搜索结果按需请求。

## 载荷证据

测试在 SQLite 内存库写入 4300 个班级，取回全部 22 页 `pageSize=200` 数据构造全量基线。

| 数据 | 字节数 | 相对全量下降 |
|---|---:|---:|
| 全量 4300 班级 | 1,233,006 | - |
| `/api/classes` 默认页 | 14,305 | 98.8% |
| `/api/classes/options` | 3,267 | 99.7% |

默认页与 options 均满足“相对全量下降 >=80%”的目标。

## 测试

`tests/classes-pagination.test.mjs` 新增并强化：

1. 4300 班级默认页有界、总数稳定、翻页不重复。
2. 搜索可到达第 4200 个班级。
3. options 有界且支持 `q`。
4. 第 4300 个班级可通过 options `q` 与 `ids` 回填到达。
5. 默认页与 options 载荷相对全量下降 >=80%。

当前分页测试：5/5 PASS。

## 门禁

| 门禁 | 结果 | 说明 |
|---|---|---|
| Typecheck | PASS | 实现提交 `5d509c8` 时通过；`36fe402` 仅改测试文件 |
| Lint | PASS | 同上 |
| Full tests | PASS | 352/352（含最新载荷断言） |
| API inventory | PASS | 120/120 |
| Surface audit | PASS | 0 异常 |
| Teaching E2E | PASS | 50+ 教学检查 |
| Build | PASS | vinext build 成功 |
| Migration | N/A | 本 Sprint 无 schema/migration |

## 部署

- GitHub main：`36fe40248ac941b44ffec00ffcb7fef101290f42`
- Sites 版本：64（`appgver_2f9d03561e948191aaa160a3f5a166cd`）
- 部署 ID：`appgdep_6a7750abe6508191ae491dfd1f047f5e`
- 状态：succeeded
- 生产 URL：https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site

## Smoke

公开 smoke PASS：

- `/` -> 200
- `/teacher-login` -> 200
- `/api/session` -> 200 `{"authenticated":false}`
- `/api/classes` -> 401（未登录，符合预期）
- `/api/classes/options` -> 401（未登录，符合预期）

认证 smoke：BLOCKED。无 `PROD_SMOKE_TEACHER` 生产凭据，本轮不覆盖生产 Secret、不放宽认证。

## 结论

READY FOR STAGING。
