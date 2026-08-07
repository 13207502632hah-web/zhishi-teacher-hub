# 知师研室第二轮体验细化复核与修复计划（2026-08-07）

> 复核人：Codex（本地静态盘点 + GitHub 公开项目检索 + 第一轮门禁基线复核）
> 范围：本轮聚焦四个高频教学工作流：课表导入、题库导入、组卷工作台、题库筛选。
> 前提：第一轮计划（`docs/comprehensive-audit-2026-08-06.md`）的 P1-01～P3-05 已完成，
> 本轮只做体验与连贯性细化，先出计划单，后续按本单逐项修复。

## 1. 复核方法

1. 静态审读页面、API、领域库与现有测试：`app/schedule-imports/`、`app/api/schedule-imports/`、
   `app/questions/`、`app/api/questions/`、`app/api/question-sets/`、`app/papers/`、
   `app/api/papers/`、`app/lib/paper-workbench.ts`、`app/lib/question-import.ts`。
2. GitHub 公开项目检索：通过 GitHub REST API 检索“自动组卷、题库导入、课表导入、Word 题库解析”
   等关键词，核验 star、语言与描述，作为功能成熟度对照。
3. 与现有门禁对照：`tests/*-redesign.test.mjs`、`scripts/teaching-loop-e2e.mjs`、
   `scripts/surface-audit.mjs`、`scripts/api-inventory.mjs`。

## 2. GitHub 同类项目对照

| 项目 | star | 技术栈 | 对照启示 |
| --- | --- | --- | --- |
| yx8118/TestPapaerGen-WebApp | 143 | SpringBoot + React | 自动组卷系统：遗传/贪心算法、题库导入、手动/自动组卷、docx 导出、历史查询；本组卷计划应参考“算法约束 + 历史可查” |
| baymaxsjj/exam | 102 | Java + Vue3 | 遗传算法自动组卷、文本批量导入题目；本组卷推荐算法与批量导入上限应有同样明确约束 |
| JinLingxi/MathCyclus---Lingxi-Question-Bank-Assistant | 92 | Python/Streamlit | OCR 识别、题库管理、自动归档；导入后“报告 + 待处理清单”是标准闭环 |
| zijian-optics/SolaireEPDA | 81 | Python | 组卷、题库管理、知识图谱维护、学情分析工程化；筛选应支持组合维度与结构概览 |
| Libnezz/ExamForge | 1 | Python | 智能题库与自动组卷：Word/PDF/图片 OCR 导入、多条件组卷、导出 Word/TXT；与本站题库导入直接对标 |
| a6hinandh/School_TimeTable_Generator | 1 | JavaScript/FastAPI | 课表生成：4 步引导、Excel 批量导入、不可行诊断、实时校验；本站课表导入已具备 3 步引导，缺历史与诊断提示 |
| gaoboguang/Academic-Affairs-System | 1 | Python/SQLite | 本地优先教务系统：Excel 导入导出、离线存储；课表导入应支持失败/重试状态 |
| RJEdTech/Raider-Quiz-Builder | 1 | HTML | 浏览器内把 Word 转题库：带标记解析、错误诊断；本站题库导入的“解析一致性提示”可参考 |

### 2.1 对照结论

成熟项目普遍具备：导入后的可查历史、导入报告与待补充清单、明确的算法约束和结构平衡、
筛选计数反馈、失败可重试。本站四块功能“能用”但缺少这些收尾能力，是第二轮修复重点。

## 3. 现状复核结果

### 3.1 课表导入

- `GET /api/schedule-imports` 已返回最近 30 个任务，但页面未消费；没有单任务详情 GET，
  刷新后预览即丢，无法回到历史批次。
- `detectScheduleMapping` 只做别名全等匹配，表头变体（括号、空格、必填标注）识别不了，
  失败时页面没有“哪些列未识别”的可操作提示。
- 确认后只有汇总文案，没有逐行最终状态和新建课时链接。
- 任务状态只有 `preview/confirmed`，无 `partial/failed`，大批文件无进度与重试入口。

### 3.2 题库导入

- `app/api/question-sets/import/route.ts` 对 `questions` 直接 `slice(0, 300)`，超量静默截断，
  页面无提示，可能造成整卷后半部分丢失。
- `source` 路由返回文件指纹，但页面只保存 key；import 路由用自己的内容指纹去重，
  两处指纹不互通，“同文件重传”无法被文件级识别。
- 队列只持久化 `key/name/status`，不含文件；刷新后 waiting/processing 全变 failed，
  需重新选文件。
- 第 4 步报告只有一行汇总，没有题型分布、待补充清单、低置信度清单。

### 3.3 组卷工作台

- 候选题请求 `/api/questions` 默认 `pageSize=50` 且不带 `page`，页面却写
  `bank.slice(0, 100)`，实际最多只能看 50 题，无总数、无加载更多。
- 自动推荐只按 `useCount` 升序 + 题型换序，目标总分不参与停止条件，难度/知识点分布未平衡，
  推荐结果不可解释。
- 候选区无“清空筛选”，已选区无“清空已选”，结构概览只有题型/难度两行文本。
- 已保存试卷筛选只在内存手动调用，刷新即丢，未持久化到 URL/本地状态。

### 3.4 题库筛选

- `facets` 只返回 distinct 值，无每个值的题目数量；组合筛选后无“命中 N 题”反馈。
- `knowledge` 用 `LIKE %关键词%`，多关键词/多值组合不友好，且未转义通配符。
- 组卷候选场景没有专用聚合/随机/智能排序接口，与题库分页耦合。

## 4. 详细计划单

> 每项完成后必须跑“第 5 节全量门禁”，全部通过再进入下一项。

### R2-01 课表导入历史任务与旧报告入口

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：`GET /api/schedule-imports` 有列表但页面未用；无 `GET /api/schedule-imports/[id]`；
  页面刷新后预览即丢，无法回溯批次。
- 理由：课表补导/复导是高频操作，教师需要区分批次、重看上次逐行结果并核对课时；
  没有历史记录，“先识别、后确认”的流程不可追溯。
- 修复：
  1. 页面新增“最近导入”面板，消费列表接口：状态、文件名、识别数、新建/调整/跳过/阻止、时间。
  2. 新增 `GET /api/schedule-imports/[id]`，返回任务 report 与逐行数据（action/issue/lesson_id），
     已确认任务可只读重看。
  3. 历史详情复用预览行渲染，行内给“查看相关课时”链接。
  4. `scripts/teaching-loop-e2e.mjs` 增加“上传→确认→列表出现→打开历史详情”断言。
- 验收：刷新后仍能打开最近任务；历史详情逐行显示最终动作与课时链接；surface-audit 无新异常。

### R2-02 表头模糊识别与待识别列提示

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：`detectScheduleMapping` 全等匹配；`上课时间（周一）`、`结束 时间`、`日期（必填）`
  等常见变体识别不了，422 只返回 headers，页面无可操作提示。
- 理由：教师真实表格表头不规范，全等匹配会造成大量“识别失败”且用户不知道改哪列。
- 修复：
  1. 表头归一化：去空白、括号内容、中英文标点、必填标注。
  2. 支持包含匹配与编辑距离候选，保留原始列名用于展示。
  3. 422 响应增加 `unknownColumns`；页面显示“未识别列”与建议别名。
  4. 单元测试覆盖变体表头。
- 验收：常见变体可自动映射；未识别列有明确提示；新增测试通过。

### R2-03 确认后逐行结果与课时链接

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：confirm 只返回汇总计数；页面确认后仅显示 message，新建/更新行没有课时链接。
- 理由：导入完成后的首要动作是核对新课时和定位失败行，只有汇总无法闭环。
- 修复：
  1. confirm 响应增加逐行 `rows`（action、issue、lessonId）。
  2. 页面在“导入完成”区渲染逐行最终状态，新建/调整行链接到 `/lessons/[id]`。
  3. 失败行展示原因并可返回预览定位。
- 验收：确认后每行可见最终动作与课时链接；e2e 断言 confirm 响应 rows 齐全且链接有效。

### R2-04 大批量/失败任务重试与状态 UI

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：任务只有 `preview/confirmed`；confirm 中单行失败只计数并 blockRow，任务仍标 confirmed；
  大文件无进度反馈。
- 理由：大批量课表确认可能中途失败，用户需要知道哪些行写入、哪些可重试，且重试不能重复建课。
- 修复：
  1. 新增 `partial`/`failed` 状态；按行 `lesson_id` 判断幂等。
  2. 失败任务显示“重试剩余行”，重试只处理未写入行。
  3. 上传/解析阶段增加行数级进度反馈。
- 验收：模拟单行失败后任务为 partial；重试不重复创建课时；e2e 覆盖。

### R2-05 题库导入超量不静默截断

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：import API `slice(0, 300)`；超量静默丢弃，页面无提示。
- 理由：整卷 Word 常见超过 300 题（尤其材料题多小题），静默截断会造成数据丢失；
  且指纹只覆盖前 300 题，重导可能形成半截重复任务。
- 修复：
  1. 服务端对解析数 > 300 返回 422 或按批建任务（建议先 422 + 明确上限）。
  2. 页面识别后提示“共 N 题，超过单任务上限 300”，提供拆分或分批建议。
  3. e2e 断言超量文件被明确拒绝，不产生半截任务。
- 验收：301 题文件返回明确错误且无写入；页面出现上限提示。

### R2-06 原始文件与解析结果一致性

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：`source` 路由已返回文件指纹，但页面只保留 key；import 路由用自己的内容指纹去重，
  文件指纹未参与任务级去重/断点。
- 理由：同一文件重传或解析规则变化会绕过文件级识别；断点恢复也需要以文件为锚点。
- 修复：
  1. import 请求携带 `sourceKey + fingerprint`，服务端校验文件存在并把指纹写入
     `question_sets.sourceFingerprint`。
  2. 同文件再次导入返回 409 并指向原任务。
  3. 恢复任务直接按文件指纹定位，不再依赖浏览器解析状态。
- 验收：同文件二次导入 409 且返回原 setId；不同文件含相同题仍按内容提示重复；e2e 覆盖。

### R2-07 导入队列断点与刷新恢复

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：队列只存 `key/name/status`，不含 File；刷新后 waiting/processing 全变 failed，
  要求重新选文件。
- 理由：多文件批量导入中刷新/断网是常态，当前把“已上传源文件”与“未上传本地文件”混为一谈，
  用户无法恢复已完成的解析结果。
- 修复：
  1. 上传解析后立即持久化 `sourceKey` 与解析结果（或服务端任务），waiting 项刷新后保持 waiting。
  2. 已上传项点击“开始”时用服务端文件重新解析/继续；未上传项明确提示需重新选择。
  3. 或改用 IndexedDB 保存 File 引用，刷新后继续队列。
- 验收：处理 3 个文件时刷新，第 1 个任务可继续校对，其余项状态说明清晰，无“全部失败”误报。

### R2-08 导入报告增强

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：第 2 步有 `summary.typeCounts`，但第 4 步只有一行汇总，无题型分布、待补充清单、
  低置信度清单。
- 理由：入库后教师需要知道题型结构和还缺哪些字段，才能决定继续校对或返回修改。
- 修复：
  1. 第 4 步展示题型分布、`incomplete` 清单（题号 + 缺什么）、`lowConfidence` 清单、
     重复/相似题数量。
  2. 每项可点击跳转到对应题或对应筛选。
- 验收：导入 20 题后报告显示分布与至少一个待补充项；点击能定位到题。

### R2-09 组卷候选题分页/加载更多

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：候选题请求不带 `page`，实际只拿 50 题；页面 `bank.slice(0, 100)` 与真实分页不一致，
  无总数、无加载更多。
- 理由：题库上千题时只给 50 条候选会漏掉合适题目，手动挑选与智能推荐都不可信。
- 修复：
  1. 页面展示“共 N 题，已显示 M 题”，新增“加载更多”请求下一页并追加。
  2. 新增组卷专用 `candidate` 模式或接口：返回总数、分布、分页与随机/智能排序，
     避免和题库列表分页耦合。
  3. 移除误导性的 `bank.slice(0, 100)`。
- 验收：1000 题题库中候选可翻页显示超过 50 题；总数正确；加载更多不重复。

### R2-09 验证（2026-08-07）

- `app/papers/page.tsx` 请求携带 `page`，读取响应 `total/page/pageCount` 并持久化
  `candidateTotal/candidatePageCount`；候选面板显示“共 N 题 · 已显示 M 题”，
  “加载更多候选题”请求下一页并按 id 去重追加；移除误导性的 `bank.slice(0, 100)`。
- 新增 `app/paper-workbench.css` 的 `.candidateMeta` 与 `.candidateLoadMore` 样式；
  `tests/paper-workbench-redesign.test.mjs` 与 `rendered-html.test.mjs` 增加分页
  静态契约；`scripts/teaching-loop-e2e.mjs` 新增组卷候选分页业务模块，断言第一页
  与第二页总数/页码一致且无重复题目。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，265 项测试全部通过（0 fail / 0 skipped，新增分页契约 1 项）。
- `pnpm teaching:e2e`：通过；11 个业务模块共 46 项检查，新增“组卷候选分页总数一致”
  与“组卷候选加载更多不重复”两项，报告 `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-14 验证（2026-08-07）

- `app/api/questions/route.ts` 的 `knowledge` 筛选改为多关键词 AND：按
  `、/空格` 分词后，每个 token 用 `instr(...) > 0` 在 `knowledge_points` 与
  `secondary_knowledge` 上做字面子串匹配，`%`/`_` 不再被 LIKE 当作通配符；
  `q/source` 的全文搜索仍保留原有 LIKE 语义。
- 题库页知识点输入框提示更新为“支持多个知识点，用空格或、分隔”；
  `tests/rendered-html.test.mjs` 新增“knowledge filter supports multiple AND
  tokens without LIKE wildcards”静态契约。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，272 项测试全部通过（0 fail / 0 skipped，新增 1 项）。
- `pnpm teaching:e2e`：通过；11 个业务模块共 46 项检查，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-13 验证（2026-08-07）

- `app/api/questions/facets/route.ts` 改为返回 `{ value, count }`：每条 facet 用
  `SELECT column AS value, COUNT(*) AS count ... GROUP BY column ORDER BY count DESC, column`
  统计并按计数降序；`hierarchy` 扩展 `topic/question_type/difficulty/region/exam_type/year`，
  组合筛选下其他已选条件会参与重新计数。
- `app/questions/page.tsx` 的 facet 状态改为
  `Record<string, Array<{ value; count }>>`：教材版本/册别/单元/课题/年级/地区下拉显示
  “值 · N 题”，年级为空时回退到 `grades`；facet 请求携带
  `topic/type/difficulty/region/year` 等组合条件；结果区新增
  “当前筛选命中 {total} 题”反馈。
- `tests/rendered-html.test.mjs` 新增静态契约
  “question facet counts drive combined-filter feedback”（`COUNT(*)`、`GROUP BY`、
  `ORDER BY count DESC`、命中数与 `item.count` 渲染断言）。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，271 项测试全部通过（0 fail / 0 skipped，新增 1 项）。
- `pnpm teaching:e2e`：通过；11 个业务模块共 46 项检查，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-12 验证（2026-08-07）

- `app/papers/page.tsx` 的试卷筛选已持久化到 URL：初始化时从
  `paperSearch/paperStatus/academicYear/examCategory/stage/grade/province/city/district/school`
  恢复；`filterPapers` 通过 `history.replaceState` 重写 `/papers?...` 后重新加载；
  `clearPaperFilters` 清空列表筛选并重写 URL；页面新增“清空试卷筛选”按钮。
- `tests/paper-workbench-redesign.test.mjs` 新增静态契约
  “saved paper filters persist to the URL and restore on refresh”。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，270 项测试全部通过（0 fail / 0 skipped，新增 1 项）。
- `pnpm teaching:e2e`：通过；11 个业务模块共 46 项检查，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-10 验证（2026-08-07）

- 新增 `app/lib/paper-recommend.ts`：`recommendPaperQuestions` 先剔除无效/零分
  候选，再按题型、难度、知识点覆盖做贪心平衡；目标总分达到即停止，不足时返回
  `reachedTarget/countGap/scoreGap/reasons/distributions`。
- `app/papers/page.tsx` 新增 `loadAllCandidates`：先用 `candidate=1` 拉取全量候选
  id（`allIds`），再按 50 个一批补齐题目，自动推荐不再只依赖第一页 50 题；
  `QuestionsResponse` 类型补充 `allIds`。
- 推荐结果带可解释理由，页面明确提示“已达到目标总分”或“还差 N 题 N 分”。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，269 项测试全部通过（0 fail / 0 skipped，新增推荐引擎
  单测与页面契约 4 项）。
- `pnpm teaching:e2e`：通过；11 个业务模块共 46 项检查，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-11 验证（2026-08-07）

- 候选区新增“清空筛选条件”（`clearCandidateFilters`），已选区新增“清空已选题”
  二次确认（`clearSelected`）。
- 结构概览改为可折叠面板：总分/目标、题量/上限、题型分布、难度分布、知识点覆盖，
  并展示自动推荐的理由与题型/难度/知识点分布。
- `app/paper-workbench.css` 新增 `workbenchClear`、`structureOverview`、
  `structureGrid`、`recommendReport` 样式，移动端单列，40rem 起双列。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，269 项测试全部通过（0 fail / 0 skipped）。
- `pnpm teaching:e2e`：通过；11 个业务模块共 46 项检查，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-10 自动推荐算法平衡

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：`recommend` 只按 `useCount` 升序 + 题型换序；目标总分不参与停止条件，
  难度/知识点分布未平衡，推荐结果不可解释。
- 理由：用户输入目标总分却得不到对应总分；成熟组卷系统都以“约束 + 结构平衡”为核心。
- 修复：
  1. 候选打分：按目标总分、题量、题型占比、难度曲线、知识点覆盖做约束过滤与贪心/组合选择。
  2. 目标总分达到或接近时停止；不足时明确报告缺口并提示放宽条件。
  3. 推荐结果附带理由（如“补足材料题 8 分”）。
- 验收：设 100 分/10 题时推荐总分在合理误差内或明确报告缺口；推荐含题型/难度/知识点分布；
  约束引擎有单元测试。

### R2-11 组卷快捷操作与结构概览

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：候选区无“清空筛选”，已选区无“清空已选”；结构概览只有题型/难度两行文本。
- 理由：反复调整条件时，缺少一键清空与结构总览会让大试卷管理低效。
- 修复：
  1. 候选区加“清空筛选条件”；已选区加“清空已选题”二次确认。
  2. 结构概览改为可折叠面板：题型/难度/知识点/分值分布 + 与目标总分的差额。
- 验收：一键清空生效；概览数据与已选列表一致。

### R2-12 已保存试卷筛选持久化

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：`filterPapers` 只手动调用并替换内存列表，刷新丢失。
- 理由：按条件筛选试卷库是高频查询，应与题库筛选一样可刷新/分享上下文。
- 修复：将 `paperSearch/status/学年/地区` 写入 URL searchParams（或本地状态），
  初始化时恢复并自动加载；筛选按钮只负责刷新。
- 验收：设置筛选后刷新页面仍保持筛选与结果；URL 可复制。

### R2-13 facet 计数与组合反馈

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：`facets` 只返回 distinct 值，无数量；页面无“当前筛选命中 N 题”反馈。
- 理由：没有计数的 facet 无法指导收窄条件；组合筛选后用户不知道结果规模。
- 修复：
  1. facets 返回 `{ value, count }` 并按 count 降序。
  2. 页面在筛选条显示“命中 N 题”；facet 选项带计数徽标。
  3. 组合筛选生效后按其他已选条件重新计数。
- 验收：选择“高中”后 facet 计数变化；页面显示命中数；e2e 断言。

### R2-14 知识点多关键词/多值筛选

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：`knowledge` 用 `LIKE %kw%`，多关键词不友好，通配符未转义。
- 理由：知识点是政治题库核心维度，教师常按多个知识点组合筛选。
- 修复：
  1. `knowledge` 支持 `、/空格` 分隔，token 化后 AND 匹配知识点或二级知识点。
  2. 或新增 `knowledgeAny` 参数支持 OR；LIKE 通配符转义。
- 验收：`民主 法治` 命中同时包含两词的题目；`%`/`_` 被转义；测试覆盖。

### R2-15 e2e 与门禁同步

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：现有 e2e 未覆盖本轮新行为；新 API 若加入必须同步 `api-inventory` 引用。
- 理由：计划单没有回归证据就无法验收。
- 修复：扩展 `scripts/teaching-loop-e2e.mjs` 业务断言（导入历史、超量拒绝、队列恢复、
  facet 计数、推荐平衡、分页加载），同步 `api-inventory` 与 `docs/testing.md`。
- 验收：每项修复后全量门禁通过。

## 5. 执行顺序与全量门禁

建议批次：

1. 批次 E1（课表导入）：R2-01 → R2-02 → R2-03 → R2-04
2. 批次 E2（题库导入）：R2-05 → R2-06 → R2-07 → R2-08
3. 批次 E3（组卷）：R2-09 → R2-10 → R2-11 → R2-12
4. 批次 E4（筛选）：R2-13 → R2-14
5. 收尾：R2-15

每完成一项执行并记录证据：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm teaching:e2e
node scripts/surface-audit.mjs
pnpm api:inventory -- --strict
pnpm mini:production-guard
```

执行须知：

- 本地用 Node 22.13+，已验证 Node 22 与 Node 24 均可。
- 跑 guard/e2e 前确认端口 3000 无残留 dev server。
- 不提交 `.dev.vars.*`；不回滚用户未请求的改动。
- 每批次完成后把验证证据追加到本文件与 `docs/comprehensive-audit-2026-08-06.md`。

### 批次 E1 验证（2026-08-07，R2-01 / R2-03）

已完成 R2-01 与 R2-03，验证证据如下：

- 新增 `app/api/schedule-imports/[id]/route.ts`（GET 详情，权限 `lessons:read`，
  校验正整数 id，返回 `import` 与逐行 `rows`，含 `rowNumber/action/issue/lessonId/
  normalizedData`）；列表接口将 `report` 从 JSON 字符串解析为对象；
  confirm 接口响应新增最终 `rows`，重复 confirm 也返回 rows。
- 页面新增“最近导入”历史面板与旧报告入口，确认后逐行渲染最终状态并链接
  `/lessons/[id]`；新增历史/链接样式与静态契约测试。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，260 项测试全部通过（0 fail / 0 skipped，新增 1 项）。
- `pnpm teaching:e2e`：通过；10 个业务模块共 34 项检查（schedule-imports 由
  3 项扩展为 5 项），报告 `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 319 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-02 验证（2026-08-07）

- `detectScheduleMappingDetail` 新增归一化（去空白、括号内容、中英文标点、
  必填/选填标注）、精确优先 + 包含匹配 + 编辑距离候选；保留原始列名。
- 上传接口成功与 422 响应均返回 `unknownColumns`（原始列名 + 建议别名）；
  页面新增“未识别列”提示块，指出可改为的列名或“该列不会参与导入”。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，262 项测试全部通过（新增表头模糊识别与
  API/页面契约 2 项）。
- `pnpm teaching:e2e`：通过；10 个业务模块共 34 项检查。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 319 探测 /
  0 异常。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-04 验证（2026-08-07）

- 新增 `app/lib/schedule-import-status.ts`：按最终行动作计算
  `partial / failed / confirmed` 与 `remaining`；confirm 接口跳过已写入行
  （created/updated/skipped），对已有 `lesson_id` 的 pending 行补标幂等，
  单行写入失败置为 blocked 并写“写入中断，请重试剩余行”；重试使用重新校验结果，
  不再依赖存储旧 issue；任务状态落库为 `partial/failed/confirmed`，审计记录
  `confirm` 或 `confirm_retry`。
- 页面新增上传阶段“读取、解析、核对”进度条与剩余行数提示；`partial/failed`
  任务显示“重试剩余 N 行”，确认后仍展示已完成/失败行；历史详情顶部也提供
  重试入口，成功后刷新详情与列表。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，264 项测试全部通过（0 fail / 0 skipped，新增
  partial/failed/confirmed 状态推导与页面契约 2 项）。
- `pnpm teaching:e2e`：通过；10 个业务模块共 36 项检查，新增“课表部分完成状态”
  与“课表失败任务重试只补剩余行”两项，报告 `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 319 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-05 验证（2026-08-07）

- import API 导出 `QUESTION_SET_IMPORT_LIMIT = 300`，解析题目数超过上限时返回
  422，错误信息包含“单个导入任务最多 300 题”、本次识别数与上限，不再 `slice(0, 300)`
  静默截断；页面在 `upload()` 与队列 `runQueue()` 两处识别超量后均明确提示
  “超过单任务上限 300 题；请把 Word 拆分成多个文件后分批导入”。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，264 项测试全部通过（0 fail / 0 skipped，静态契约新增
  import 上限常量、422 判断与页面拆分提示断言）。
- `pnpm teaching:e2e`：通过；10 个业务模块共 37 项检查，新增“题库导入超量明确拒绝”
  （301 题返回 422，错误含 300 与 301），报告 `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 319 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-06 验证（2026-08-07）

- import API 接受 `sourceKey + sourceFingerprint`：有 sourceKey 时先校验 R2 文件仍存在
  （不存在返回 422 提示重新上传）；有文件指纹时优先按 `question_sets.sourceFingerprint`
  定位原任务，同文件重复导入返回 409 且带原 setId，并把文件指纹写入任务记录；
  无指纹的直连调用仍回退到内容指纹去重。
- 新增 `GET /api/question-sets/import?sourceFingerprint=…`（权限 `questions:read`），
  按文件指纹返回原任务，刷新后可脱离浏览器解析状态定位任务；页面在队列恢复时按指纹
  把已上传项恢复为原任务并跳转继续校对。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，264 项测试全部通过（0 fail / 0 skipped，静态契约新增文件
  校验、指纹定位与页面指纹传递断言）。
- `pnpm teaching:e2e`：通过；10 个业务模块共 40 项检查，新增“按文件指纹恢复导入任务”
  “同文件重复导入按原任务拦截”“不同文件相同题按内容提示重复”三项，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 321 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖
  （新增 GET 后方法分布 GET=88）。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-07 验证（2026-08-07）

- `GET /api/question-sets/source?key=…`（权限 `questions:read`）返回原始 Word 文件，
  不存在时 404 提示“原始 Word 文件不存在或已过期，请重新上传”；响应直接用
  `new Response(object.body, …)`，避免 R2 对象无 `arrayBuffer()` 的兼容问题。
- 页面队列持久化 `sourceKey + sourceFingerprint`：刷新后 waiting/processing 项有
  sourceKey 时保持可继续（提示“文件已上传，可继续处理”），无 sourceKey 时置 failed
  并提示重新选择同名文件；`resolveQueueFile` 对只有 sourceKey 的项通过 source GET
  下载 Blob 并重建 File，`runQueue` 不再要求刷新后保留本地 File。
- 队列开始按钮与单项按钮按 `item.file || item.sourceKey` 过滤，状态文案区分
  “可继续/开始/重试”，并保留“继续校对”链接。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，264 项测试全部通过（0 fail / 0 skipped，静态契约新增
  source GET 与页面恢复相关断言）。
- `pnpm teaching:e2e`：通过；10 个业务模块共 42 项检查，新增“原始文件断点下载”
  与“原始文件缺失提示重新上传”两项，报告 `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖
  （新增 GET 后方法分布 GET=89）。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-08 验证（2026-08-07）

- `app/lib/question-import.ts` 的 `summarizeImport` 与
  `app/api/question-sets/import/route.ts` 新增 `typeCounts`、`incompleteItems`
  （题号 + 缺失字段清单）、`lowConfidenceItems`（题号 + 置信度）；报告仍写入
  `question_sets.importReport`，刷新恢复后由页面解析展示。
- 第 4 步新增题型分布徽标、待补充清单与低置信度清单，每项按钮可回到第 3 步定位
  对应题；重复/相似合计显示并可跳转待校对列表。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，264 项测试全部通过（0 fail / 0 skipped，新增
  summarize 清单断言与页面/API 静态契约断言）。
- `pnpm teaching:e2e`：通过；10 个业务模块共 44 项检查，新增“导入报告题型分布”
  与“导入报告待补充与低置信度清单”两项，报告 `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

### R2-15 验证（2026-08-07）

- `GET /api/questions` 在 `candidate=1` 时返回全量候选 id，不再被 300 上限
  截断；普通分页仍保留 300 id 上限，页面用 `allIds` 分批补齐候选。
- e2e 新增 3 个业务模块：
  - `questionFacetCounts`：facet 返回 `{ value, count }`，计数与库内聚合一致；
  - `questionKnowledgeMultiKeyword`：空格/、分隔的多关键词 AND 命中主知识点或
    二级知识点，`%`/`_` 按字面匹配；
  - `paperRecommendationAllCandidates`：320 题候选 `candidate=1` 全量返回且无重复。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，272 项测试全部通过（0 fail / 0 skipped，静态契约新增
  knowledge 多 token AND 与通配符字面匹配断言）。
- `pnpm teaching:e2e`：通过；14 个业务模块共 53 项检查，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。
- `docs/testing.md`：同步新增 e2e 覆盖点与最新基线（119 API 全覆盖、323 探测）。
