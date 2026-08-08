# R1-04R Failure Analysis

日期：2026-08-08（Asia/Shanghai）

范围：关闭题库近似重复检测在 5k/20k/50k benchmark 下 recall=0.75 的已知召回缺口。
只修改 candidate generation 与回归测试；未改动 auth、finance、schedule import、
source authorization，未触碰 benchmark ground truth 与既有断言。

## 1. Baseline 失败证据

G1 修复前快照（`e7f7b25`）各规模指标：

| scale | ground_truth | candidate_hits | false_negatives | recall | top3_recall | precision |
|---|---:|---:|---:|---:|---:|---:|
| 1k | 12 | 12 | 0 | 1.0 | 1.0 | 0.9231 |
| 5k | 12 | 9 | 3 | 0.75 | 0.75 | 0.9 |
| 20k | 12 | 9 | 3 | 0.75 | 0.75 | 0.9 |
| 50k | 12 | 9 | 3 | 0.75 | 0.75 | 0.9 |

5k/20k/50k 各自漏掉的 3 个 case：

| scale | case_type | source_index | target_position（1-based） | comparable_universe | candidate_pool | rank | final_top3 |
|---|---|---:|---:|---|---|---:|---|
| 5k | punctuation-only change | 1 | 601 | yes | no | - | no |
| 5k | whitespace change | 2 | 1751 | yes | no | - | no |
| 5k | candidate-pool boundary (outside budget) | 10 | 3000 | yes | no | - | no |
| 20k | punctuation-only change | 1 | 2401 | yes | no | - | no |
| 20k | whitespace change | 2 | 7001 | yes | no | - | no |
| 20k | candidate-pool boundary (outside budget) | 10 | 18000 | yes | no | - | no |
| 50k | punctuation-only change | 1 | 6001 | yes | no | - | no |
| 50k | whitespace change | 2 | 17501 | yes | no | - | no |
| 50k | candidate-pool boundary (outside budget) | 10 | 48000 | yes | no | - | no |

三个规模漏掉的是同一种结构性缺口：候选 SQL 只取最新 2000 行，池外行一律不进入
候选池。漏掉 case 按类型可以合并为两组：

- punctuation / whitespace 两个 text-variant 旧行（`0.12n` / `0.35n` 附近）
- boundary outside（`0-based n-2001`，紧邻旧候选池外）

## 2. Failure stage

全部 9 个 false negative 都属于：

```text
B. CANDIDATE_GENERATION_MISS
```

没有任何 case 进入候选池后被 similarity/ranking 淘汰，因此不存在
A / C / D / E。所有 planted positive 在进入候选池后 recall / top1 / top3 全为
1.0。也没有 INVALID_GROUND_TRUTH：这些 case 与对应 ref 的题义一致，是合理
duplicate。

## 3. Candidate generation 审计

修复前候选检索使用的特征：

| feature | 实现 |
|---|---|
| fingerprint | `fingerprint IN (...)` 精确匹配 |
| question_type | `question_type IN (...)` |
| stage | `stage IN (...)` |
| grade | `grade IN (...)` |
| stem token | 最多 12 个代表性 bigram token，`stem LIKE '%token%'` OR |
| ordering | `ORDER BY id DESC LIMIT 2000` |

为什么漏掉：

- ground-truth bank 所有行都共享 `单选题/高中/高一`，metadata 条件命中全表，
  WHERE 实际等价于全表；候选池因此只由 `ORDER BY id DESC LIMIT 2000` 决定，
  只覆盖库尾 2000 行。
- punctuation / whitespace / boundary-outside 三行都位于最新 2000 行之外，
  无论文本有多相似都不会进入候选池。
- fingerprint 因 wording variation 不同，精确 fingerprint 路径不可能命中。
- question_type/stage/grade 分桶无法缩小候选范围（全部同桶）。
- 题干 bigram token 路径仍受同一 `ORDER BY id DESC LIMIT` 约束，池外行同样不可达。
- 不存在 text-prefix/normalized-text 特征，因此“规范化后相同、原始字符串不同”
  的旧行没有任何专门召回路径。

## 4. Production fix

修复位于 `app/lib/question-import-candidates.ts`，采用“多路候选召回 + 合并去重”的
bounded architecture：

### Candidate Source A（保留）

fingerprint 精确命中；与既有行为一致。

### Candidate Source B（保留）

question_type / stage / grade 兼容分桶 + 代表性 stem bigram token OR；有界
`ORDER BY id DESC LIMIT`。

### Candidate Source C（新增 text signature）

- 对每个导入 ref 的题干做 `normalize()`（NFKC、小写、去掉空白/标点/符号），
  取前 8 个字符作为文本签名。
- 签名按字符用 `%` 连接成 LIKE 模式，例如
  `基础题干0材料分析` -> `%基%础%题%干%0%材%料%分%`，可容忍空格、标点在
  对应位置穿插的旧行。
- 每个模式一条有界子查询：
  `SELECT id, stem, fingerprint FROM (SELECT id, stem, fingerprint FROM questions WHERE stem LIKE ? ORDER BY id DESC LIMIT 25)`。
- 50 个模式一批，用 `UNION ALL` 合并，一批最多 50 个 bind params，低于 D1
  每条 statement 100 个 bind params 的限制。
- 各批并行执行，按 id 去重后排序，文本路径上限 `TEXT_CANDIDATE_BUDGET = 400`。
- 模式文本始终作为 bind param 传入；coverage COUNT 中内联的 LIKE 字面量经过
  SQL 单引号转义，不会引入未预期的通配符。

### 合并

- `remaining = max(0, budget - textCandidates.length)`，metadata/fingerprint/token
  路径用剩余预算继续取最新行。
- 两路候选按 id 合并去重，最终按 `id DESC` 排序。
- `coverage.total` = 满足 metadata 条件 **或** text pattern 的去重行数；
  `coverage.compared` = `candidates.length`；`complete = compared >= total`。
- 该语义与 route 和 `app/questions/page.tsx` 消费的
  `SimilarityCoverage` 完全兼容。

### 为什么有界

- 每个 text pattern 最多 25 行，每批 50 个模式。
- text 路径合并后最多 400 行。
- 总预算仍为 `QUESTION_SIMILARITY_BUDGET = 2000`。
- 最坏 comparisons = 导入 refs x 2000，不随题库规模线性扩张，未退回全库 O(N*M)。

## 5. Ranking / similarity

修复前所有 false negative 都没有进入候选池，因此本轮没有修改 similarity score、
threshold、权重或 normalization。唯一 FP 仍为“同材料不同问法” hard negative
（相似度 0.833 >= 0.82），precision 从 0.9 恢复并保持在 0.9231（1k 口径一致），
没有用塞无关题进 top3 的方式换 recall。

## 6. Regression test

`tests/question-import-candidates.test.mjs` 新增：

```text
text signature recall reaches rows outside the latest-2000 pool
when metadata matches the whole bank
```

测试构造 5000 行全同 metadata bank，在 index 500 / 750 / 1000 植入 punctuation、
whitespace、boundary-outside 三个变体，断言：

- 三个旧行都进入候选池；
- candidate 数量不超过 2000；
- coverage 明确 `complete=false`（不把有界扫描伪装成全库）；
- 三个旧行都能到达 similarity report。

修复前该测试 RED（旧 `ORDER BY id DESC LIMIT 2000` 全部漏掉），修复后 GREEN。

## 7. 修复后结果

### 重复检测指标（fresh run，`outputs/scale-benchmark.json`）

| scale | ground_truth | candidate_hits | top1_hits | top3_hits | false_negatives | false_positives | recall | precision | top1_recall | top3_recall | coverage | candidate_count | comparisons | latency_ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1.0 | 1.0 | 1000/1000 | 1000 | 14000 | 90.26 |
| 5k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1.0 | 1.0 | 1990/5000 | 1990 | 27860 | 203.37 |
| 20k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1.0 | 1.0 | 1990/20000 | 1990 | 27860 | 196.16 |
| 50k | 12 | 12 | 12 | 12 | 0 | 1 | 1.0 | 0.9231 | 1.0 | 1.0 | 1990/50000 | 1990 | 27860 | 248.45 |

### Candidate 性能（mixed bank，300 refs）

| scale | before candidates/comparisons | before ms | after candidates/comparisons | after ms | after sql |
|---|---:|---:|---|---:|---:|---:|
| 1k | 1000 / 300000 | 1099.05 | 534 / 160200 | 564.69 | 8 |
| 5k | 2000 / 600000 | 2646.56 | 1999 / 599700 | 2251.92 | 8 |
| 20k | 2000 / 600000 | 2396.98 | 1999 / 599700 | 2880.57 | 8 |
| 50k | 2000 / 600000 | 2330.32 | 1999 / 599700 | 3517.52 | 8 |

重复检测完整流程（含 similarity scan）在 5k/20k/50k 的 latency 为 203.37 /
196.16 / 248.45 ms，对比修复前 G1 快照 279.89 / 276.72 / 274.92 ms，有改善但
不是数量级变化，且 SQL 语句数从 1 增至 8，因此 performance 保持 PARTIAL。

### Honest coverage

修复后 5k/20k/50k 的 coverage 仍为 `complete=false`（1990/5000、1990/20000、
1990/50000）。这表示候选预算有界截断，不是全库级检测；API 显式报告实际比对范围，
不把部分比对伪装成全库。ground-truth 全部 12 个 positive 都在候选池内，因此
`candidate_recall = 12/12 = 1.0`。

### Gates

| Gate | Result |
|---|---|
| targeted unit tests | PASS 8/8（0 fail / 0 skipped） |
| typecheck | PASS（`tsc --noEmit` 0 错误） |
| lint | PASS（ESLint 0 error / 0 warning） |
| full tests | PASS 342/342（0 fail / 0 skipped，含 vinext build） |
| scale benchmark | PASS 1k/5k/20k/50k |
| build | PASS（`pnpm build` 成功） |
| git diff --check | PASS（仅 CRLF 提示） |

## 8. Final labels

```text
R1_04_SEMANTICS: VERIFIED
R1_04_CANDIDATE_RECALL: VERIFIED
R1_04_TOP3_RECALL: VERIFIED
R1_04_PRECISION: VERIFIED
R1_04_PERFORMANCE: PARTIAL
```
