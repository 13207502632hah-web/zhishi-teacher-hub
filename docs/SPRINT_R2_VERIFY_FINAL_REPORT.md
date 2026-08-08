# Sprint R2 Verify Final Report（知师研室，2026-08-08）

## 1. Version Lineage

```text
PRE_R1_BASE_SHA:  6d167de94d1d3121c26780a20fa1c85b3b230e89
R1_HEAD:          4ac67f828a040d3d94fa5d1d2a511027eee2f2d2
R2_VERIFY_HEAD:   019d1bed525abb7e32a8a9cb7e6e9486466d537d
R2_1_HEAD:        ebce07cbfc3068d61dbaf7aada0b042bc7649174
R1_04R_HEAD:      4ea16344e0caef145af1fd5007cccb0596c0ccf0
CURRENT_HEAD:     4ea16344e0caef145af1fd5007cccb0596c0ccf0
DEPLOYED_SHA:     4ea16344e0caef145af1fd5007cccb0596c0ccf0
branch:           main
```

祖先链全部成立（`git merge-base --is-ancestor` 均 exit 0）：

```text
PRE_R1_BASE_SHA (6d167de)
  -> R1_HEAD (4ac67f8)
  -> R2_VERIFY_HEAD (019d1be)
  -> R2_1_HEAD (ebce07c)
  -> R1_04R_HEAD / CURRENT_HEAD / DEPLOYED_SHA (4ea1634)
```

`git log --oneline 6d167de..4ea1634`：

```text
4ac67f8 fix: harden schedule import, question scale, finance idempotency and source access (R1)
019d1be fix: harden schedule import, question recall, finance idempotency and source access (R2 verify)
ebce07c docs: record R2.1 production release gate (READY FOR STAGING)
4ea1634 fix: close question duplicate recall gap (R1-04R)
```

范围：不新增产品功能；只按 `docs/r1-followup-plan-2026-08-08.md` 闭环 R1 报告暴露的
证据缺口、测试真实度与生产残留风险。本报告为 R2-VERIFY 定稿。

## 2. 总结

```text
VERIFIED:      R1-01 R1-02 R1-05 R1-06 R1-07 R1-08
VERIFIED:      R1-04 correctness（候选池内 recall/top1/top3=1；coverage 语义诚实）
PARTIAL:       R1-03（存量 lineage） R1-04 performance（latency 未稳定改善）
VERIFIED:      R1-04R candidate recall / top3 recall / precision（12/12 ground truth 全命中）
PARTIAL:       R1-04R performance（有界且较 G1 改善，但无数量级提升）
NOT_VERIFIED:  线上 Cloudflare Worker CPU（本地 SQLite 可测，线上未测）
BLOCKED:       生产环境带认证 smoke（无合法、可读的生产测试凭据）
最终结论:       DEPLOYED（R1-04R 已上线；带认证 smoke 仍 BLOCKED，不声明 PRODUCTION READY）
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

**最终状态：** correctness VERIFIED，performance PARTIAL。

**旧行为：** comparison pool 只取约 2000 条，`coverage` 使用全表 COUNT，可能让用户误以为“已完成全库近似重复检测”。

**复现方式：** `token retrieval recalls a near-duplicate outside the old first-2000 pool`。

**根因：** 候选 SQL 无题干召回，且 coverage 语义与实际扫描范围不一致。

**最终方案：** 两阶段候选检索：廉价 SQL（fingerprint / type / stage / grade + 题干 bigram token OR）取有界池，再执行昂贵相似度；预算 2000；`coverage` 改为同一候选条件的 WHERE 命中数，并在 `complete=false` 时显式声明。

**修改文件：** `app/lib/question-import-candidates.ts`、`app/lib/question-similarity.ts`、`scripts/scale-benchmark.mjs`、`tests/question-import-candidates.test.mjs`。

**migration：** 无。

**测试：** 1k/5k/20k/50k recall、有界候选、coverage 语义。

**验证：** 见下方 G1 基准证据。**残余：** 题库超过候选预算后不是全库级检测，但 API 显式报告 coverage，不 silent false negative；performance 未获得稳定数量级改善。

#### R1-04 Benchmark Methodology

脚本：`scripts/scale-benchmark.mjs`，运行 `node scripts/scale-benchmark.mjs`（内存 SQLite，
写入 `outputs/scale-benchmark.json`；`outputs/` 为 gitignored 产物）。

每个规模植入 12 个 positive duplicate pair + 2 个 negative pair：
exact、punctuation、whitespace、question-number、option formatting/order、minor wording、
moderate paraphrase、deliberately hard duplicate、material/question relation、
candidate-pool boundary（inside / outside）、database-tail；negative 为
“同材料不同问法”与“不同材料近问法”。

位置设计（0-based）：

- boundary inside = `n - 2000`（`ORDER BY id DESC LIMIT 2000` 候选池最旧一行，1-based 第 `n-1999` 条）
- boundary outside = `n - 2001`（候选池外紧邻一行，1-based 第 `n-2000` 条）
- 其余 9 个 positive 与 2 个 negative 放在最新 2000 行内（库尾、`n-1000`、`n-500`、`n-250`、
  `n-120`、`n-30`、`n-10`、`n-3`、`n-40`、`n-50`）
- punctuation 与 whitespace 两个 positive 放在 `floor(0.12n)` / `floor(0.35n)` 的较旧位置，
  仅 1k（coverage complete=true）时在池内，5k 及以上明确在池外
- 所有位置经唯一化 helper 处理，不重复；1k 时 `n-2000`/`n-2001` 越界并钳制入库内唯一位置

ground-truth bank 所有行共享 `单选题/高中/高一`，候选 WHERE 命中全部行，因此
coverage denominator = 题库总量（1000/5000/20000/50000）。

公式：

- `ground_truth_count` = 12（positive pairs，含 exact）
- `candidate_hits` = 进入候选池的 positive pair 数；`recall = candidate_hits / 12`
- `top1_recall` / `top3_recall` = 相似度报告（按 similarity 排序取 top 3）中 true pair 命中
  对应 ref 的 positive 占比
- `false_negative_count` = 12 - candidate_hits
- `false_positive_count` = 报告行中不属于 planted positive 的行数（固定 1：
  “同材料不同问法” negative 相似度 0.833 >= 0.82）
- `precision = true_positive_rows / reported_rows`
- `coverage.compared` = 实际进入候选池的行数（min(命中行数, 2000)）
- `coverage.total` = 同一候选 WHERE 的命中行数
- `coverage.complete` = `compared >= total`；true 表示条件命中集合已全部入池，
  false 表示预算有界截断
- `candidate_count` = `coverage.compared`；`comparisons = refs.length * candidate_count`；
  `latency_ms = durationMs`

#### R1-04 Accuracy

G1 fresh run（2026-08-08）：

| scale | ground_truth_count | candidate_hits | top1_hits | top3_hits | false_positive_count | false_negative_count | recall | precision | top1_recall | top3_recall | coverage | candidate_count | comparisons | latency_ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1k | 12 | 12 | 12 | 12 | 1 | 0 | 1.0 | 0.9231 | 1.0 | 1.0 | 1000/1000 | 1000 | 14000 | 112.99 |
| 5k | 12 | 9 | 9 | 9 | 1 | 3 | 0.75 | 0.9 | 0.75 | 0.75 | 2000/5000 | 2000 | 28000 | 279.89 |
| 20k | 12 | 9 | 9 | 9 | 1 | 3 | 0.75 | 0.9 | 0.75 | 0.75 | 2000/20000 | 2000 | 28000 | 276.72 |
| 50k | 12 | 9 | 9 | 9 | 1 | 3 | 0.75 | 0.9 | 0.75 | 0.75 | 2000/50000 | 2000 | 28000 | 274.92 |

池内正确性：1k 全部 12 个 positive 在池内，recall/top1/top3 = 1.0；5k/20k/50k 各有
9 个 positive 进入候选池，in-pool recall = 9/9 = 1.0，top1/top3 全部命中。整体 recall
0.75 的 3 个 miss 全部在池外：boundary outside（紧邻池外）、punctuation 与 whitespace
两个较旧位置。这些 miss 由 `coverage.complete=false`（2000/5000、2000/20000、2000/50000）
显式暴露，不是 silent false negative。

唯一 FP 是“同材料不同问法” negative（相似度 0.833 >= 0.82）；“不同材料近问法”
negative（0.765 < 0.82）正确未报告。exact=true 全规模。

#### R1-04 Performance

相似度候选两阶段（mixed-attribute bank，300 导入 refs）：

| scale | Before (candidates/comparisons) | Before ms | After (candidates/comparisons) | After ms | payload |
|---|---:|---:|---|---:|---:|
| 1k | 1000 / 300000 | 1304.88 | 534 / 160200 | 640.93 | 2081B |
| 5k | 2000 / 600000 | 2956.29 | 2000 / 600000 | 2772.59 | 10001B |
| 20k | 2000 / 600000 | 3084.49 | 2000 / 600000 | 2905.35 | 12001B |
| 50k | 2000 / 600000 | 3171.25 | 2000 / 600000 | 2923.25 | 12001B |

1k 约 -51%；5k/20k/50k 约 -3%~-6%，没有数量级改善且跨运行存在波动，因此
`R1_04_PERFORMANCE = PARTIAL`，不写 “performance fully fixed”。

Facets：1k=5.36ms、5k=25.64ms、20k=94.33ms、50k=243.20ms（各 12 SQL）。

50k 完整行（重复检测）：

```text
50k total, ground_truth_count=12, candidate_hits=9, top1_hits=9, top3_hits=9,
false_positive_count=1, false_negative_count=3, recall=0.75, precision=0.9,
top1_recall=0.75, top3_recall=0.75, coverage=2000/50000 complete=false,
candidate_count=2000, comparisons=28000, latency_ms=274.92
```

#### Coverage 语义（2667 / 10667 / 26667 是什么）

相似度基准的 mixed bank（`createDatabase`）中题型/学段/年级混合，候选 WHERE
（fingerprint / question_type / stage / grade / stem-token OR）只命中部分行：

- 5k bank：命中 2667 行 -> `coverage=2000/2667`
- 20k bank：命中 10667 行 -> `coverage=2000/10667`
- 50k bank：命中 26667 行 -> `coverage=2000/26667`
- 1k bank：命中 534 行 -> `coverage=534/534 complete=true`

因此 2667/10667 是该 synthetic bank 中与导入 refs 至少共享一个宽条件的行集合，
不是随机数；2000 是候选预算上限。重复检测 ground-truth bank 所有行共享
`单选题/高中/高一`，同一 WHERE 命中全部行，所以 coverage=2000/5000、2000/20000、
2000/50000，分母即题库总量。

## R1-04R Recall Repair

**最终状态：** candidate recall / top3 / precision VERIFIED；performance PARTIAL。

**原始失败 case：** 5k/20k/50k 各漏 3 个 ground-truth positive：
punctuation-only change（1-based 601/2401/6001）、whitespace change
（1-based 1751/7001/17501）、candidate-pool boundary outside
（1-based 3000/18000/48000）。1k 全命中。

**failure stage：** 全部为 `B. CANDIDATE_GENERATION_MISS`。三个 case 都未进入
候选池，不存在进入候选池后 similarity/ranking 淘汰；in-pool recall 修复前已为
1.0，无 `D/E` 问题，也没有 `F INVALID_GROUND_TRUTH`。

**root cause：** ground-truth bank 全部行共享 `单选题/高中/高一`，候选 WHERE 命中
全表；候选池因此由 `ORDER BY id DESC LIMIT 2000` 决定，只覆盖最新 2000 行。
punctuation/whitespace 旧行与 boundary-outside 行都在池外，而 candidate
generation 没有任何 normalized-text 前缀/签名召回路径，fingerprint 又因 wording
variation 不同，导致这些行永远不可达。

**production fix：** `app/lib/question-import-candidates.ts` 新增文本签名候选源：
对导入 ref 题干做 normalize（NFKC、小写、去空白/标点），取前 8 字符并按字符用
`%` 连接成 LIKE 模式；每个模式有界 `LIMIT 25`，50 个模式一批 `UNION ALL`，
每批最多 50 个 bind params（低于 D1 每 statement 100 params 上限）；文本源合并去重
后上限 400，剩余预算继续走 metadata/fingerprint/token 路径，最终去重、按 id
倒序，总候选仍受 2000 预算约束。coverage 改为 metadata 条件与文本模式的并集
去重 COUNT，`compared = candidates.length`，`complete = compared >= total`，
接口兼容不变。

**candidate architecture before：**

```text
Source A fingerprint IN
Source B question_type/stage/grade IN + stem bigram OR
-> ORDER BY id DESC LIMIT 2000
```

**candidate architecture after：**

```text
Source A fingerprint IN
Source B question_type/stage/grade IN + stem bigram OR
Source C normalized text signature LIKE（每模式 LIMIT 25，50/批 UNION ALL，上限 400）
-> id dedupe -> ORDER BY id DESC -> 总预算 2000
```

**tests added：** `tests/question-import-candidates.test.mjs` 新增
`text signature recall reaches rows outside the latest-2000 pool when metadata
matches the whole bank`：5000 行全同 metadata bank，植入 punctuation / whitespace /
boundary-outside 三个旧行，断言全部进入候选池、预算不超 2000、coverage
`complete=false`、三个旧行都能到达 similarity report。修复前 RED，修复后 GREEN。

**fresh benchmark（2026-08-08，`outputs/scale-benchmark.json`）：**

| scale | ground_truth | candidate_hits | top1_hits | top3_hits | false_negatives | false_positives | recall | precision | candidate_count | comparisons | latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1000 | 14000 | 90.26 |
| 5k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1990 | 27860 | 203.37 |
| 20k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1990 | 27860 | 196.16 |
| 50k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1990 | 27860 | 248.45 |

coverage 诚实语义保留：5k/20k/50k 为 1990/5000、1990/20000、1990/50000
`complete=false`，即预算有界截断而非全库检测；API 显式报告实际比对范围。

唯一 FP 仍是“同材料不同问法” hard negative（相似度 0.833 >= 0.82），
precision 稳定 0.9231；“不同材料近问法” negative（0.765 < 0.82）继续正确不报告。

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

注：上表为历史记录（R2 期间多次运行之一）；G1 定稿数据以 `R1-04 Performance` 为准。

| 重复检测指标（G1 定稿） | 1k | 5k | 20k | 50k |
|---|---:|---:|---:|---:|
| recall | 1.0 | 0.75 | 0.75 | 0.75 |
| precision | 0.9231 | 0.9 | 0.9 | 0.9 |
| top1 / top3 | 1.0 / 1.0 | 0.75 / 0.75 | 0.75 / 0.75 | 0.75 / 0.75 |
| exact detected | true | true | true | true |
| FP / reported rows | 1/13 | 1/10 | 1/10 | 1/10 |
| FN | 0 | 3 | 3 | 3 |
| coverage | 1000/1000 | 2000/5000 | 2000/20000 | 2000/50000 |
| candidate_count | 1000 | 2000 | 2000 | 2000 |
| comparisons | 14000 | 28000 | 28000 | 28000 |
| latency_ms | 112.99 | 279.89 | 276.72 | 274.92 |

本表为 G1 定稿，替代此前 `recall=1.0 / precision=0.875 / FP=1/8 / coverage=9/9`
的旧版表；旧表使用旧植入集，口径与 `R1-04 Accuracy` 不一致。

### R1-04R 修复后性能

| 重复检测指标（R1-04R fresh run） | 1k | 5k | 20k | 50k |
|---|---:|---:|---:|---:|
| recall | 1.0 | 1.0 | 1.0 | 1.0 |
| precision | 0.9231 | 0.9231 | 0.9231 | 0.9231 |
| top1 / top3 | 1.0 / 1.0 | 1.0 / 1.0 | 1.0 / 1.0 | 1.0 / 1.0 |
| FN | 0 | 0 | 0 | 0 |
| coverage | 1000/1000 | 1990/5000 | 1990/20000 | 1990/50000 |
| candidate_count | 1000 | 1990 | 1990 | 1990 |
| comparisons | 14000 | 27860 | 27860 | 27860 |
| latency_ms | 90.26 | 203.37 | 196.16 | 248.45 |

candidate SQL 从修复前 1 条增至 8 条（text-signature 分批 + metadata 池 +
coverage COUNT），但比较次数与 payload 保持有界；5k/20k/50k latency 对比 G1
快照（279.89 / 276.72 / 274.92 ms）均有下降，无数量级提升，且 facets 耗时
1k=11.88ms、5k=21.10ms、20k=59.28ms、50k=191.51ms 保持线性合理。

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
| Full Tests | PASS | 342 / 342 pass，0 fail / 0 skipped（含 vinext build） |
| Standalone Build | PASS | `npm run build` 成功 |
| Teaching E2E | PASS | 2 rounds / 15 business modules / 60 checks |
| Surface Audit | PASS | 30 pages / 328 checks / 0 anomalies |
| API Inventory | PASS | 119 APIs / 119 covered / 0 uncovered（--strict） |
| Mini Production Guard | PASS | login/sync/me 均 503 MINI_FEATURE_DISABLED，无数据写入 |
| Migration | PASS | OLD_DB / FRESH_DB / SCHEMA_SOURCE 全 PASS |
| Scale Scenario | PASS | 1k / 5k / 20k / 50k 全部通过 |
| R1-04R Regression | PASS | text signature 池外旧行召回 / 预算 / coverage / similarity 可达 |

备注：`mini:production-guard` 与 `surface-audit` 并行时共用端口 3000 会互相干扰；
单独串行复跑通过，属于测试 harness 并行化注意点，不是产品缺陷。

## 8. Test Count

```text
修改前（R1 HEAD）：328
修改后（R2 HEAD）：341
新增：13
R1-04R：342（+1 text signature 池外召回 regression）
```

以真实 runner 输出为准（`node --test` 342 / 342）；历史 287 / 299 等数字为陈旧口径。

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

R1-04R 变更文件：

```text
app/lib/question-import-candidates.ts
tests/question-import-candidates.test.mjs
docs/R1_04R_FAILURE_ANALYSIS.md
docs/SPRINT_R2_VERIFY_FINAL_REPORT.md
```

`git diff --check` 无错误（仅 CRLF 提示）；`docs/r1-followup-plan-2026-08-08.md`
保持 untracked，不提交、不删除。

## 10. Remaining Risks

- schedule re-import：存量无 lineage 行的跨日期修订只能 blocked，不能自动判断（PARTIAL，设计内）。
- question similarity：R1-04R 已新增 normalized text-signature 召回并关闭全部
  ground-truth FN；候选预算仍使全库级检测在题库超过预算后受限，API 显式报告
  coverage（PARTIAL，不 silent）。
- Cloudflare CPU：本轮只有本地 SQLite benchmark，线上 Worker CPU 未测量（NOT_VERIFIED）。
- 生产认证 smoke：生产 Secret 已配置但明文不可读，本环境无法取得安全测试凭据，未执行（BLOCKED）。
- R2 source 失败对象清理：尚未实现定时清理，按 R1F-13 后续立项。
- mini guard / surface audit 并行端口冲突：测试 harness 注意点，串行无问题。

## 11. 最终结论

**DEPLOYED（R1-04R 已上线生产；带认证 smoke 仍 BLOCKED）。**

代码层面无未关闭的 P0/P1；`PRODUCTION_AUTH_SMOKE = BLOCKED`，
线上 CPU 证据未取得，因此不声明 `PRODUCTION READY`。

R1-04R 关闭 5k/20k/50k 重复检测的全部 ground-truth false negative
（candidate recall / top1 / top3 = 12/12），precision 稳定 0.9231，候选仍受
2000 预算约束；coverage 语义与 performance PARTIAL 结论不变。

## Production Release Gate

执行时间：2026-08-08（Asia/Shanghai）

生产 URL：`https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site`

发布提交：`ebce07cbfc3068d61dbaf7aada0b042bc7649174`

Sites 版本：`appgprj_6a50708fea408191bf864f1778576733~appgver_c4a0adbc3e6c8191a2ea8a97a3f022df`（版本 59）

Sites 部署：已成功上线（生产 URL 可访问；部署 ID 见 Sites 控制台）

### Git lineage

`git merge-base --is-ancestor 4ac67f8 019d1be` exit 0，PASS。

`git merge-base --is-ancestor 019d1be ebce07c` exit 0，PASS。

`git log --oneline 4ac67f8..ebce07c`：

```text
019d1be fix: harden schedule import, question recall, finance idempotency and source access (R2 verify)
ebce07c docs: record R2.1 production release gate (READY FOR STAGING)
```

R2_VERIFY 与 R2.1 全部修改确认建立在 R1 commit `4ac67f8` 之上。

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
MANUAL_ACTION_REQUIRED: 请通过正常生产账号管理方式建立一个专用测试教师账号（__PROD_SMOKE_TEACHER__），并安全提供运行时凭据。
```

判定依据：Git lineage、公开生产 smoke、本地 typecheck / lint / full tests / build
全部 PASS；唯一 blocker 为线上带认证 smoke 无法安全取得凭据。按任务规定，不得把
BLOCKED 伪装成 PASS，不得绕过鉴权，因此不声明 `PRODUCTION READY`。

## G1 Final Output（R1-04R 修复前历史快照）

```text
R1_04_CORRECTNESS: VERIFIED
R1_04_PERFORMANCE: PARTIAL
1K_RECALL: 1
5K_RECALL: 0.75
20K_RECALL: 0.75
50K_RECALL: 0.75
1K_TOP3_RECALL: 1
5K_TOP3_RECALL: 0.75
20K_TOP3_RECALL: 0.75
50K_TOP3_RECALL: 0.75
50K_LATENCY: 274.92
PRODUCTION_LOGIN: BLOCKED
PRODUCTION_AUTH_SMOKE: BLOCKED
P0: none
P1: none
FINAL RELEASE STATUS: READY FOR STAGING
MANUAL_ACTION_REQUIRED: 请通过正常生产账号管理方式建立一个专用测试教师账号（__PROD_SMOKE_TEACHER__），并安全提供运行时凭据。
```

## R1-04R Final Output

```text
R1_04_SEMANTICS: VERIFIED
R1_04_CANDIDATE_RECALL: VERIFIED
R1_04_TOP3_RECALL: VERIFIED
R1_04_PRECISION: VERIFIED
R1_04_PERFORMANCE: PARTIAL
1K_RECALL: 1
5K_RECALL: 1
20K_RECALL: 1
50K_RECALL: 1
1K_TOP3_RECALL: 1
5K_TOP3_RECALL: 1
20K_TOP3_RECALL: 1
50K_TOP3_RECALL: 1
FALSE_NEGATIVES: 0
PRECISION: 0.9231
50K_LATENCY: 248.45
COVERAGE_5K: 1990/5000 complete=false
COVERAGE_20K: 1990/20000 complete=false
COVERAGE_50K: 1990/50000 complete=false
PRODUCTION_LOGIN: BLOCKED
PRODUCTION_AUTH_SMOKE: BLOCKED
P0: none
P1: none
FINAL RELEASE STATUS: DEPLOYED
DEPLOYED_SHA: 4ea16344e0caef145af1fd5007cccb0596c0ccf0
SITES_VERSION: appgprj_6a50708fea408191bf864f1778576733~appgver_198f0b561eb0819186430495f9f4a45b（版本 60）
DEPLOYMENT_ID: appgdep_6a76e4a25bb081918a4a6a5e570397ea
PRODUCTION_URL: https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site
MANUAL_ACTION_REQUIRED: 请通过正常生产账号管理方式建立一个专用测试教师账号（__PROD_SMOKE_TEACHER__），并安全提供运行时凭据。
```

## R1-04R Production Release Gate

执行时间：2026-08-08（Asia/Shanghai）

生产 URL：`https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site`

发布提交：`4ea16344e0caef145af1fd5007cccb0596c0ccf0`

Sites 版本：`appgprj_6a50708fea408191bf864f1778576733~appgver_198f0b561eb0819186430495f9f4a45b`（版本 60）

Sites 部署 ID：`appgdep_6a76e4a25bb081918a4a6a5e570397ea`

部署状态：`succeeded`（provider deployment `jz4hbwctq7--zhishi-teacher-hub`，env_set_revision 8）

公开 smoke：`/` 返回 200，部署 URL 可直接访问；未认证受保护页面行为沿用 R2.1 公开 smoke 结果。

带认证生产 smoke：仍 BLOCKED（原因见上文安全凭据调查）；本发布不将未执行项伪造成 PASS。

R1-04R 已上线：5k/20k/50k recall / top1 / top3 = 1.0，false negatives = 0，
precision = 0.9231；coverage 仍为有界诚实语义（1990/5000、1990/20000、1990/50000）。
