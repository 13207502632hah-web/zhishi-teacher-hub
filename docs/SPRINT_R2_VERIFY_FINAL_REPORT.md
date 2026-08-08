# Sprint R2 Verify Final Report（知师研室，2026-08-08）

## 1. Baseline

```text
BASE_SHA: 6d167de
R1_HEAD:  4ac67f8
R2_HEAD:  本轮 R2 提交（SHA 以最终汇报与部署记录为准）
branch:   main
```

范围：不新增产品功能；只按 `docs/r1-followup-plan-2026-08-08.md` 闭环 R1 报告暴露的
证据缺口、测试真实度与生产残留风险。本报告为 R2-VERIFY 定稿。

## 2. 总结

```text
VERIFIED:      R1-01 R1-02 R1-05 R1-06 R1-07 R1-08
PARTIAL:       R1-03（存量 lineage） R1-04（有界候选 coverage）
NOT_VERIFIED:  线上 Cloudflare Worker CPU（本地 SQLite 可测，线上未测）
BLOCKED:       生产环境带认证 smoke（Secret 已配置但明文不可读，未执行）
最终结论:       READY FOR STAGING
```

## 3. R1-01 ~ R1-08

### R1-01

**最终状态：VERIFIED**

**旧行为：** 单行 confirm 多步写入无事务，中途失败可能留下孤儿 lesson 或错误行状态，重试可能重复生成实体。

**复现方式：** R2 新增 8 个故障注入测试，在 class / student / enrollment / lesson / row link / finance / final mark / audit 各失败点中断后重试。

**根因：** D1 下跨动态 ID 的写入没有 ACID 事务；导入行缺少 durable processing state，无法区分“未开始 / 进行中 / 已提交未回执”。

**最终方案：** durable row state machine + retry reconciliation：任务级 `confirming` 声明、行级 claim、中断行 `finalizeInterruptedRow`、`needs_reconcile`；重试识别已写入实体并恢复，不重复 lesson / finance / enrollment。

**修改文件：** `app/api/schedule-imports/[id]/confirm/route.ts`、`app/lib/schedule-import-identity.ts`、`app/lib/schedule-import-preview.ts`、`drizzle/0028_schedule_import_recovery.sql`（R1）；`tests/schedule-import-consistency.test.mjs`、`scripts/migration-0028-verify.mjs`（R2）。

**migration：** `0028_schedule_import_recovery.sql`，新增 `processing_state / attempts / last_error / source_lineage / source_row_id / source_cell` 与索引。

**测试：** 8 个故障注入 + 10 次连续 confirm 只产生 1 个 lesson / finance / enrollment / student / class。

**验证：** `OLD_DB -> MIGRATE -> TEST PASS`、`FRESH_DB -> TEST PASS`、`SCHEMA_SOURCE -> 0028 CONSISTENT PASS`。

### R1-02

**最终状态：VERIFIED**

**旧行为：** fallback 只用 date + start_time + course_name 判重，同时间同课程不同班级可能错误 skip 并指向错误 lesson。

**复现方式：** `same time and course in another class never maps to the wrong lesson`。

**根因：** exact match 与 time conflict 概念混用。

**最终方案：** `lessonBusinessIdentity` 排除时间，保留日期 / 班级 / 学生 / 课程；时间重叠作为 blocked conflict，不作为 exact match；一对一要求完整学生集合。

**修改文件：** `app/lib/schedule-import-identity.ts`、`app/lib/schedule-import-preview.ts`。

**migration：** 无新增。

**测试：** same time/same course/different class 不误 skip；一对一学生 A/B 不互认。

**验证：** schedule-import-consistency 相关用例全绿。

### R1-03

**最终状态：PARTIAL**

**旧行为：** 重新导入无法可靠识别跨日期修订，可能静默创建第二节课。

**复现方式：** `cross-date lineage updates one lesson and blocks ambiguity`。

**根因：** 旧导入无 source lineage，无法唯一区分“原课时改日期”和“新增一节课”。

**最终方案：** 新导入行保存 source lineage + row identity；同源可唯一判断时 update，无法唯一判断时显式 blocked，绝不静默覆盖或重复。

**修改文件：** schedule import confirm / identity / preview（R1）。

**migration：** `0028` 新增 lineage 字段。

**测试：** cross-date lineage 更新 1 个 lesson；blocked 冲突不进入 lineage。

**验证：** 全绿。**残余：** 存量无 lineage 行的自动修订无法可靠完成，需人工清单（R1F-15）后续处理。

### R1-04

**最终状态：PARTIAL**

**旧行为：** comparison pool 只取约 2000 条，`coverage` 使用全表 COUNT，可能让用户误以为“已完成全库近似重复检测”。

**复现方式：** `token retrieval recalls a near-duplicate outside the old first-2000 pool`。

**根因：** 候选 SQL 无题干召回，且 coverage 语义与实际扫描范围不一致。

**最终方案：** 两阶段候选检索：廉价 SQL（fingerprint / type / stage / grade + 题干 bigram token OR）取有界池，再执行昂贵相似度；预算 2000；`coverage` 改为同一候选条件的 WHERE 命中数，并在 `complete=false` 时显式声明。

**修改文件：** `app/lib/question-import-candidates.ts`、`app/lib/question-similarity.ts`、`scripts/scale-benchmark.mjs`、`tests/question-import-candidates.test.mjs`。

**migration：** 无。

**测试：** 1k/5k/20k/50k recall、有界候选、coverage 语义。

**验证：** 全部规模 recall=1、precision=0.875、top1/top3=1、exact=true、FP=1/8。**残余：** 题库超过候选预算后不是全库级检测，但 API 显式报告 coverage，不 silent false negative。

### R1-05

**最终状态：VERIFIED**

**旧行为：** 过滤后 map 下标可能重新生成 sourceIndex，重复 fingerprint 的 Map 可能互相覆盖。

**复现方式：** `sourceIndex and sourceQuestionNumber survive exact dedupe and internal duplicates`。

**根因：** source 元数据在解析后没有不可变固化。

**最终方案：** 解析阶段固化 `sourceIndex / sourceQuestionNumber`；dedupe / filter / sort / similarity 全部引用原始索引。

**修改文件：** `app/lib/question-import-candidates.ts`、`tests/question-import-candidates.test.mjs`。

**migration：** 无。

**测试：** exact duplicate 在前 + 后续 similar；内部重复；报告仍显示原始题号。

**验证：** 全绿。

### R1-06

**最终状态：VERIFIED**

**旧行为：** 同值排序字段分页可能重复或漏行；候选模式曾存在无界 ID 读取风险。

**复现方式：** `question pagination keeps a stable secondary id order for every sort path`；15k e2e。

**根因：** 缺少稳定次级排序；candidate 需要与分页架构一致。

**最终方案：** 所有排序路径追加 `id` 次级排序；candidate 保持 `allIds <= 1200` 有界；total 用 COUNT；普通分页全量可翻页。

**修改文件：** `app/api/questions/route.ts`、`scripts/teaching-loop-e2e.mjs`、`tests/questions-list-redesign.test.mjs`。

**migration：** 无。

**测试：** 15,000 匹配题量：位置 1201 / 2000 / 5000 / 10000 / 15000 全部正确，`total=15000`，第一页无重复，candidate=1 声明有界截断。

**验证：** teaching E2E 2 轮 / 15 模块 / 60 检查全绿。

### R1-07

**最终状态：VERIFIED**

**旧行为：** batch 已提交但 `completeOperation` 抛错时会 abandon，重试无法返回已提交结果；死 Worker 会让同一 operationId 长期 409。

**复现方式：** `completeOperation failure after commit is recovered by replay`、`stale started operation is reclaimed and confirms exactly once`。

**根因：** 幂等记录与业务 commit 之间没有恢复路径；started 记录无回收。

**最终方案：** `beginOperation` 回收超过 5 分钟的 stale started；`replayCommittedFinance` 从 `lesson_finance.calculation_snapshot` 恢复已提交结果；`batchCommitted` 标记区分“未提交可 abandon”与“已提交只能重试”；`completeOperation` best-effort。

**修改文件：** `app/lib/finance-confirm.ts`、`app/lib/services/idempotency.ts`、`tests/finance-idempotency.test.mjs`。

**migration：** 无新增（R1 已建 `idempotency_operations`）。

**测试：** exact replay 200 `replayed:true`、altered payload / lesson 409、10 并发只结算一次、expired preview、legacy confirmed、adjustment replay、stale reclaim、commit 后补写失败恢复。

**验证：** 全绿。

### R1-08

**最终状态：VERIFIED**

**旧行为：** 未关联 sourceKey 默认可读，助教可读取不属于授权范围的 R2 对象。

**复现方式：** `assistant can read own uploads but denies unassociated foreign uploads`。

**根因：** `if (!referenced) return true` 允许无关联对象绕过授权。

**最终方案：** 未关联对象必须 `customMetadata.uploadedBy === access.id`；关联对象按 question_set / class / paper / assessment / assignment / workflow 链路授权；恶意 key 无法绕过对象存在性与角色校验。

**修改文件：** `app/lib/question-source-access.ts`、`tests/question-source-security.test.mjs`。

**migration：** 无。

**测试：** teacher / assistant 正反场景、关联链路、恶意 key、非助教角色。

**验证：** 全绿。

## 4. Investigations

### I-01 Facets

证据：1k / 5k / 20k / 50k 各 12 SQL，耗时 2.97 / 12.97 / 58.67 / 156.30 ms。
决定：本轮不新增 index；线上 CPU 证据不足，不做无依据优化。

### I-02 Ownership

证据：`findClassId` 按 `owner_id` 过滤，route 创建 class 使用当前 access.id。
决定：已满足 owner scope，不改。

### I-03 Student Scope

证据：同名学生 preview 与 confirm 一致 blocked。
决定：不改。

## 5. 数据库

- schema change：无本轮新增表 / 字段 / index；R1 的 `0028_schedule_import_recovery.sql` 为本轮复核对象。
- migration：新增 `scripts/migration-0028-verify.mjs`，验证旧库升级、新库直建、schema 源一致性，全部 PASS。
- constraints：`idempotency_operations.operation_id` 唯一约束生效；`INSERT OR IGNORE` 防并发穿透。
- backward compatibility：存量行 `processing_state=NULL` 可被 claim（attempts 从 0 起算），legacy lineage 保持 NULL。

## 6. 性能结果

| 场景 | Before | After |
|---|---:|---:|
| 1k questions | sql=1 candidates=1000 comparisons=300000 997.54ms payload=3894B top=1 | sql=2 candidates=534 comparisons=160200 471.21ms payload=2081B top=1 coverage=534/534 complete=true |
| 5k questions | sql=1 candidates=2000 comparisons=600000 2093.63ms payload=8894B top=0 | sql=2 candidates=2000 comparisons=600000 2014.67ms payload=10001B top=1 coverage=2000/2667 complete=false |
| 20k questions | sql=1 candidates=2000 comparisons=600000 2227.17ms payload=8894B top=0 | sql=2 candidates=2000 comparisons=600000 2090.11ms payload=12001B top=1 coverage=2000/10667 complete=false |
| 50k questions | sql=1 candidates=2000 comparisons=600000 2334.46ms payload=8894B top=0 | sql=2 candidates=2000 comparisons=600000 2145.42ms payload=12001B top=1 coverage=2000/26667 complete=false |

| 重复检测指标 | 1k | 5k | 20k | 50k |
|---|---:|---:|---:|---:|
| recall | 1.0 | 1.0 | 1.0 | 1.0 |
| precision | 0.875 | 0.875 | 0.875 | 0.875 |
| top1 / top3 | 1.0 / 1.0 | 1.0 / 1.0 | 1.0 / 1.0 | 1.0 / 1.0 |
| exact detected | true | true | true | true |
| FP | 1/8 | 1/8 | 1/8 | 1/8 |
| coverage | 9/9 | 9/9 | 9/9 | 9/9 |

| Facets | 1k | 5k | 20k | 50k |
|---|---:|---:|---:|---:|
| SQL 数 | 12 | 12 | 12 | 12 |
| 耗时 | 2.97ms | 12.97ms | 58.67ms | 156.30ms |

| Candidate payload | 结果 |
|---|---|
| 15k 匹配题库普通分页 | 每页 50 条，位置 1201 / 2000 / 5000 / 10000 / 15000 正确，total=15000 |
| candidate=1 | allIds <= 1200 且 < total，显式 `candidateLimited=true` |
| similarity comparisons | 300 导入题 x 2000 预算，上限 600k 次，50k 题库不扩张 |

线上 Cloudflare Worker CPU：无法直接测量，N/A。

## 7. 测试门禁

| Gate | Result | Details |
|---|---|---|
| Typecheck | PASS | `tsc --noEmit` 0 错误 |
| Lint | PASS | ESLint 0 error / 0 warning；`outputs/**` 已忽略 |
| Full Tests | PASS | 341 / 341 pass，0 fail / 0 skipped（含 vinext build） |
| Standalone Build | PASS | `npm run build` 成功 |
| Teaching E2E | PASS | 2 rounds / 15 business modules / 60 checks |
| Surface Audit | PASS | 30 pages / 328 checks / 0 anomalies |
| API Inventory | PASS | 119 APIs / 119 covered / 0 uncovered（--strict） |
| Mini Production Guard | PASS | login/sync/me 均 503 MINI_FEATURE_DISABLED，无数据写入 |
| Migration | PASS | OLD_DB / FRESH_DB / SCHEMA_SOURCE 全 PASS |
| Scale Scenario | PASS | 1k / 5k / 20k / 50k 全部通过 |

备注：`mini:production-guard` 与 `surface-audit` 并行时共用端口 3000 会互相干扰；
单独串行复跑通过，属于测试 harness 并行化注意点，不是产品缺陷。

## 8. Test Count

```text
修改前（R1 HEAD）：328
修改后（R2 HEAD）：341
新增：13
```

以真实 runner 输出为准（`node --test` 341 / 341）；历史 287 / 299 等数字为陈旧口径。

## 9. Git

R2 变更文件：

```text
app/api/questions/route.ts
app/lib/finance-confirm.ts
app/lib/question-import-candidates.ts
app/lib/question-similarity.ts
app/lib/question-source-access.ts
app/lib/services/idempotency.ts
eslint.config.mjs
scripts/scale-benchmark.mjs
scripts/teaching-loop-e2e.mjs
scripts/migration-0028-verify.mjs
tests/finance-idempotency.test.mjs
tests/question-import-candidates.test.mjs
tests/question-source-security.test.mjs
tests/questions-list-redesign.test.mjs
tests/schedule-import-consistency.test.mjs
docs/R1_DIFF_AUDIT.md
docs/SPRINT_R2_VERIFY_FINAL_REPORT.md
```

`git diff --check` 无错误（仅 CRLF 提示）；`docs/r1-followup-plan-2026-08-08.md`
保持 untracked，不提交、不删除。提交后 `git log --oneline 6d167de..HEAD` 为：
`4ac67f8` + 本轮 R2 提交。

## 10. Remaining Risks

- schedule re-import：存量无 lineage 行的跨日期修订只能 blocked，不能自动判断（PARTIAL，设计内）。
- question similarity：候选预算使全库级检测在题库超过预算后受限；API 显式报告 coverage（PARTIAL，不 silent）。
- Cloudflare CPU：本轮只有本地 SQLite benchmark，线上 Worker CPU 未测量（NOT_VERIFIED）。
- 生产认证 smoke：生产 Secret 已配置但明文不可读，本环境无法取得安全测试凭据，未执行（BLOCKED）。
- R2 source 失败对象清理：尚未实现定时清理，按 R1F-13 后续立项。
- mini guard / surface audit 并行端口冲突：测试 harness 注意点，串行无问题。

## 11. 最终结论

**READY FOR STAGING。**

代码层面无未关闭的 P0/P1；`PRODUCTION_AUTH_SMOKE = BLOCKED`，
线上 CPU 证据未取得，因此不声明 `PRODUCTION READY`。

## Production Release Gate

执行时间：2026-08-08（Asia/Shanghai）

生产 URL：`https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site`

发布提交：`019d1bed525abb7e32a8a9cb7e6e9486466d537d`

Sites 版本：`appgprj_6a50708fea408191bf864f1778576733~appgver_37e10ead31cc81918544da919b719956`（版本 58）

Sites 部署：`appgdep_6a76ac811a2c81918a097b99f2d259e5`（`succeeded`）

### Git lineage

`git merge-base --is-ancestor 4ac67f8 019d1be` exit 0，PASS。

`git log --oneline 4ac67f8..019d1be`：

```text
019d1be fix: harden schedule import, question recall, finance idempotency and source access (R2 verify)
```

R2_VERIFY 全部修改确认建立在 R1 commit `4ac67f8` 之上。

### 安全凭据调查（BLOCKED 根因）

- 生产 Sites Secret 已配置 `TEACHER_ADMIN_ACCOUNT` / `TEACHER_ADMIN_PASSWORD` /
  `TEACHER_ADMIN_SESSION_SECRET`，但连接器对全部 Secret 仅返回 `value:null`，
  本环境无法取得明文。
- 项目没有 Web 注册/建号 API；Web 登录只接受环境配置的单教师管理员身份，
  助教/学生/家长角色未接通 Web 登录，不存在可安全复用的专用
  `__R2_PROD_SMOKE__` 测试账号机制。
- 使用工作区外 `local-dev-vars.patch` 中的既有测试凭据（非仓库内容）对生产
  `/api/auth/login` 实测，返回 401，确认不是生产凭据。
- 不能通过覆盖生产 Secret 注入测试凭据：原值不可读，覆盖会永久改变真实管理员
  密码；不能修改鉴权逻辑或加入测试后门（任务明确禁止）。
- 因此本环境无法在不等待用户提供凭据、不违反安全边界的前提下执行线上带认证
  smoke。

### 公开生产 Smoke

重新执行并记录：

```text
/ -> 200
/teacher-login -> 200
/api/session -> {"authenticated":false}
/workspace -> 307（到 /teacher-login）
/schedule-imports -> 307（到 /teacher-login）
/questions -> 307（到 /teacher-login）
/papers -> 307（到 /teacher-login）
```

未认证受保护页面按预期跳转教师登录页，无 5xx。

### 带认证生产 Smoke

| 项 | 结果 |
|---|---|
| Login | BLOCKED |
| Session | BLOCKED |
| Logout | BLOCKED |
| Schedule import | BLOCKED |
| Repeated confirm | BLOCKED |
| Finance exactly-once | BLOCKED |
| Question import + duplicate detection | BLOCKED |
| Source authorization | BLOCKED |
| Candidate pagination | BLOCKED |
| Cleanup | N/A（未创建任何 smoke 对象） |

未创建任何 `__R2_PROD_SMOKE__` 生产业务对象，未污染真实教学/财务/题库数据，
因此无测试数据需要清理。

### 5xx / 错误

公开 smoke 期间无 5xx。带认证路径因安全凭据不可取得未执行，无法收集认证后的
错误日志，不会把未执行项伪造成 PASS。

### 最终本地回归

| Gate | Result | Details |
|---|---|---|
| Typecheck | PASS | `tsc --noEmit` 0 错误 |
| Lint | PASS | ESLint 0 error / 0 warning |
| Full Tests | PASS | 341 / 341 pass，0 fail / 0 skipped |
| Build | PASS | `vinext build` 成功 |

### Release Gate 输出

```text
PRODUCTION_LOGIN: BLOCKED
PRODUCTION_SESSION: BLOCKED
PRODUCTION_SCHEDULE_IMPORT: BLOCKED
PRODUCTION_IDEMPOTENCY: BLOCKED
PRODUCTION_QUESTION_IMPORT: BLOCKED
PRODUCTION_SOURCE_ACCESS: BLOCKED
PRODUCTION_CANDIDATE_PAGINATION: BLOCKED
PRODUCTION_CLEANUP: N/A（未创建测试数据）

P0 remaining: 无（代码/测试层面）；发布阻塞项：PRODUCTION_AUTH_SMOKE（无安全可读凭据）
P1 remaining: 无

FINAL RELEASE STATUS: READY FOR STAGING
```

判定依据：Git lineage、公开生产 smoke、本地 typecheck / lint / full tests / build
全部 PASS；唯一 blocker 为线上带认证 smoke 无法安全取得凭据。按任务规定，不得把
BLOCKED 伪装成 PASS，不得绕过鉴权，因此不声明 `PRODUCTION READY`。
