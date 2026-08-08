# R1 Diff Audit（2026-08-08 R2 定稿）

复核基线：`6d167de`（R1 BASE_SHA）→ `4ac67f8`（R1 HEAD）。
本文件是 R2-VERIFY 对 R1 实现的人工审查定稿；状态词遵循 R2 规范：
`VERIFIED / PARTIAL / FAILED / NOT_VERIFIED`。

## R1-01 课表导入可恢复一致性

**最终状态：VERIFIED**

实现采用 durable row state machine + retry reconciliation，不是 ACID 事务：

- 任务级 `confirming` 声明、行级 `claimScheduleImportRow`、中断行 `finalizeInterruptedRow`、`needs_reconcile` 状态。
- `drizzle/0028_schedule_import_recovery.sql` 新增 `processing_state / attempts / last_error / source_lineage / source_row_id / source_cell` 与索引。
- R2 新增故障注入测试覆盖 class / student / enrollment / lesson / row link / finance / final mark / audit 8 个失败点；10 次连续 confirm 只产生 1 个 lesson / finance / enrollment / student / class。
- `scripts/migration-0028-verify.mjs` 验证旧库升级、新库直建、schema 源一致性，均 PASS。

结论：单个导入行具有明确、一致、可恢复的原子语义；不允许描述为“数据库事务原子性”。

## R1-02 课时身份判定

**最终状态：VERIFIED**

- `app/lib/schedule-import-identity.ts`：业务身份排除时间，保留日期 / 班级 / 学生 / 课程。
- 同时间同课程不同班级不再错误 skip，而是 blocked；一对一要求完整学生集合。
- 测试：`same time and course in another class never maps to the wrong lesson`、`one-to-one exact identity requires the full student set`。

## R1-03 跨日期修订

**最终状态：PARTIAL**

- 新导入行具备稳定 source lineage + row identity，可做同源修订更新；跨日期 / 班级 / 学生 / 课程无法唯一判断时显式 blocked。
- 存量已确认导入没有 lineage，无法自动唯一调整；该限制由设计保留，不静默创建第二节课，也不静默覆盖。
- 测试：`cross-date lineage updates one lesson and blocks ambiguity`、`blocked conflict links do not become cross-date lineage for the blocked row`。
- 残余：存量无 lineage 行的审计清单（R1F-15）未实现，属后续产品项。

## R1-04 近似重复召回与 coverage

**最终状态：PARTIAL**

- 候选 SQL 从旧 `LIMIT 1200` 改为 `LIMIT 2000`，新增题干 bigram token OR 召回；`coverage` 从全表 `COUNT(*)` 改为同一候选条件的 WHERE 命中数。
- 5k / 20k / 50k 下 candidate pool 有界，coverage 明确 `complete=false`，不再把“只查 2000”伪装成全库无近似重复。
- 基准：1k / 5k / 20k / 50k 全部 recall=1、precision=0.875、top1/top3=1、exact=true、1/8 FP（不同材料 + 相似题干陷阱）。
- 残余：候选预算使题库超过预算后仍不是全库级重复检测，但 API 会显式报告 coverage，不再 silent false negative。

## R1-05 sourceIndex 映射

**最终状态：VERIFIED**

- 解析阶段固化 `sourceIndex / sourceQuestionNumber`；exact dedupe、内部重复、相似扫描全部引用原始索引，不使用过滤后数组下标。
- 测试：`sourceIndex and sourceQuestionNumber survive exact dedupe and internal duplicates`、`similarity report keeps original numbering after an earlier exact duplicate`。

## R1-06 candidate 有界与稳定分页

**最终状态：VERIFIED**

- `app/api/questions/route.ts`：所有排序路径增加稳定次级 `id` 排序，避免同值 `updated_at / difficulty / use_count` 分页重复或漏行。
- candidate 模式保持 `allIds <= 1200` 有界；普通分页 15,000 匹配题量可到达第 1201 / 2000 / 5000 / 10000 / 15000 位置，`total=15000`，第一页无重复。
- 测试：teaching e2e `exercise15kMatchPagination`、`question pagination keeps a stable secondary id order for every sort path`。

## R1-07 财务 durable idempotency

**最终状态：VERIFIED**

- `beginOperation` 增加 stale started 回收（超过 5 分钟）与 `INSERT OR IGNORE` 唯一约束。
- `confirmFinanceSettlement` 增加 `replayCommittedFinance`：业务 batch 已提交但幂等记录未完成时，同 operationId 重试返回 200 `replayed:true` 且不重复入账；`completeOperation` 改为 best-effort。
- 修改 payload / lesson 仍 409；10 并发只结算一次；adjustment 快照语义保留。
- 测试：`durable confirm replays exactly once and rejects altered replays`、`ten concurrent duplicate confirms settle exactly once`、`stale started operation is reclaimed and confirms exactly once`、`completeOperation failure after commit is recovered by replay` 等。

## R1-08 R2 source 权限

**最终状态：VERIFIED**

- `app/lib/question-source-access.ts`：未关联 sourceKey 不再默认可读，必须 `customMetadata.uploadedBy === access.id`；关联到 question_set 时按 class / paper / assessment / assignment / workflow 授权链路判断。
- 客户端不能自证 fingerprint；服务端以对象元数据 / 存储指纹为准。
- 测试：unassociated foreign upload denied、associated links allowed、malicious keys denied、非助教角色 denied。

## I-01 Facets

- 证据：1k / 5k / 20k / 50k 各 12 SQL，耗时 2.97 / 12.97 / 58.67 / 156.30 ms。
- 决定：本轮不新增 index；等线上 Worker CPU / EXPLAIN 证据再决定。

## I-02 Ownership

- `findClassId` 按 `owner_id` 过滤；导入创建 class 使用当前 access.id。
- 测试：`owner-scoped class lookup never reuses another owner's lesson`。

## I-03 Student scope

- 同名学生 preview 与 confirm 一致 blocked，不绕过同名防护。

## 遗留风险

- 线上 Cloudflare Worker CPU：NOT_VERIFIED（本轮只测本地 SQLite）。
- 生产认证 smoke：BLOCKED（无安全凭据）。
- R2 source 失败对象清理、存量 lineage 清单、门户 / 资源管理态等按 `docs/r1-followup-plan-2026-08-08.md` 后续立项。
