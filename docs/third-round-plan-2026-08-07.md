# 知师研室第三轮公开入口与文档一致性复核计划（2026-08-07）

> 复核人：Codex（本地静态盘点 + GitHub 公开项目实时检索 + 门禁基线复核）
> 范围：本轮聚焦公开资源发现、公开首页真实内容预览、资源中心摘要、门户与权限
> 文档一致性，以及对应测试基线。
> 前提：第一轮计划（`docs/comprehensive-audit-2026-08-06.md`）与第二轮计划
> （`docs/second-round-plan-2026-08-07.md`）已完成，本轮只做低风险闭环，不重复
> 已完成的课表导入、题库导入、组卷与筛选修复。

## 1. 复核方法

1. 静态审读 `app/api/resources/route.ts`、`app/page.tsx`、
   `app/public-entry.css`、`app/resources/page.tsx`、`README.md` 与
   `ARCHITECTURE.md`，核验公开入口的鉴权边界与文档表述。
2. 通过 GitHub REST API 实时核对同类学校/教育管理、家教教务、课表生成与题库
   组卷项目的 star、语言与描述，作为公开入口与资源中心成熟度的对照。
3. 与现有门禁对照：`tests/public-resource-discovery.test.mjs`、
   `pnpm test`、`pnpm teaching:e2e`、`node scripts/surface-audit.mjs`、
   `pnpm api:inventory -- --strict`、`pnpm mini:production-guard`。

## 2. GitHub 同类项目对照（2026-08-07 实时核对）

| 项目 | star | 技术栈 | 对照启示 |
| --- | --- | --- | --- |
| roncoo/roncoo-education | 1532 | Java | 在线教育/题库/考试体系：公开内容目录、搜索与角色权限分层成熟，本站公开资源应保持“访客可检索、管理需登录”的清晰边界 |
| hrshadhin/school-management-system | 1131 | Blade/Laravel | 学校管理：教师、学生、家长多角色入口分离；本站 `/portal` 的学生/家长只读入口是产品目标，但登录链路尚未开放，必须如实文档化 |
| 4jean/lav_sms | 1015 | PHP/Laravel | 学校管理：角色化功能菜单与隐私最小展示；公开首页不应暴露私人教学数据 |
| frappe/education | 591 | Python | 教育 ERP：教师工作台与门户分离，权限矩阵完整；门户 API 当前按教师管理员保护是过渡态 |
| hassanhabib/OtripleS | 336 | C# | 学校管理系统：教学、沟通、辅导一体化，首页应有真实可浏览内容而非只有登录入口 |
| yx8118/TestPapaerGen-WebApp | 143 | Java/React | 自动组卷：题库目录、历史查询、明确约束；公开资源摘要与检索属于同类“目录可发现性”能力 |
| baymaxsjj/exam | 102 | Java/Vue3 | 在线考试/题库：批量导入、自动组卷；本站题库已具备，公开资源中心继续按“先检索、再登录”组织 |
| JinLingxi/MathCyclus---Lingxi-Question-Bank-Assistant | 92 | Python/Streamlit | 题库管理与归档：首页/入口展示资源库规模与可检索内容，避免只给链接不给内容 |
| vfixtechnology/appointment-booking-system | 67 | Blade/Laravel | 预约/教务系统：多角色日历、可用性与提醒；本站课表/日历已覆盖，本轮不重复 |
| AzimKrishna/Tuition-Management-System | 43 | PHP | 家教管理：排课、计费、报告卡；本站教师工作台方向一致，学生/家长门户可作为后续产品项 |
| SerophinaMary/Automatic-Timetable-Generator | 38 | JavaScript | 课表生成：约束求解与冲突检测；本站课表导入已完成，本轮不重复 |
| GEOSOFT-GLOBAL/timetablely | 25 | TypeScript | 课表生成：API、管理 UI、CSV/iCal/PDF 导出；可作为后续课表导出增强的参考 |

### 2.1 对照结论

成熟项目普遍具备：公开目录/内容预览、访客可检索、管理操作按角色收口、文档中的
角色边界与实际服务端一致。本站公开资源中心已有“匿名只读公开资源”的权限实现，
但公开首页此前只有链接、没有真实内容预览；`/portal` 的产品目标与当前实现混在
一起。本轮据此补齐低风险闭环，不引入学生/家长登录这类需要独立产品决策的改动。

## 3. 现状复核结果

### 3.1 公开资源 API

- `GET /api/resources` 此前匿名请求会返回公开资源，但没有 `scope=public`、
  `limit` 或公开摘要；公开首页无法按“只读公开”契约安全取数。
- 修复后：`scope=public` 强制 `visibility=public`；`limit` 上限 20；响应新增
  `summary.publicCount` 与 `popularTags`；新增、删除与私有范围读写仍要求教师或
  已授权助教。

### 3.2 公开首页

- 此前“公开阅览室”只有“进入公开资源中心”链接，访客看不到真实资源、数量或标签。
- 修复后：首页新增 `PublicResourcePreview`，加载最近 3 份公开资源并展示公开数量、
  热门标签与空/错误状态；样式为移动优先，48rem 起桌面增强。

### 3.3 资源中心

- 资源中心页面此前只消费 `resources` 与 `canWrite`，未展示公开摘要。
- 修复后：页面复用同一 API 的 `summary`，在首页区块展示“当前公开 N 份”与前 3 个
  热门标签，保证首页与资源中心口径一致。

### 3.4 门户与权限文档

- `README.md` 此前直接写“学生/家长只读门户”，与实际“门户页面与 API 暂按教师
  管理员登录保护”不一致。
- 修复后：README 增加“当前实现说明”；`ARCHITECTURE.md` 的 `/portal` 行改为
  “门户页面与 API 暂按教师管理员登录保护；学生/家长最小权限视图为产品目标，
  登录链路未开放”；权限原则明确匿名/公开请求只读公开资源，写操作要求教师或
  已授权助教。

## 4. 详细计划单

### R3-01 公开资源发现 API 摘要

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：资源列表接口无公开 scope、无数量上限、无公开摘要。
- 理由：公开首页和资源中心都需要“匿名只读公开资源”的安全契约；没有数量与标签
  摘要，访客无法判断资源中心是否值得进入，也无法形成目录感。
- 修复：
  1. GET 支持 `scope=public`，强制只返回公开资源。
  2. GET 支持 `limit`（正整数，上限 20），首页预览取最近 3 份。
  3. 响应新增 `summary.publicCount`（全库公开总数）与 `popularTags`
     （当前公开结果行的标签频次前 8）。
- 验收：`?scope=public&limit=3` 只返回公开资源；`publicCount` 与库内公开数一致；
  limit 超 20 被截断；新增/删除与私有范围仍按角色鉴权。

### R3-02 公开首页真实资源预览

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：公开首页只有“浏览公开资源”链接，没有真实内容。
- 理由：对照 GitHub 成熟教育/资源门户，首页应展示可浏览的真实内容，而不是只给
  入口；真实预览也能让“资源中心值得进入”的决策发生在首页。
- 修复：
  1. 首页新增“公开阅览室”区块，加载 `/api/resources?scope=public&limit=3`。
  2. 展示最多 3 条公开资源卡片、公开数量与热门标签。
  3. 空数据与读取失败有明确状态，且不把错误当作空数据。
- 验收：匿名访问首页可见真实公开资源；无资源时显示空状态；接口失败显示可重试
  提示；移动端与桌面端布局正常。

### R3-03 资源中心复用公开摘要

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：资源中心页面未展示 `summary`，首页与资源中心口径可能不一致。
- 理由：同一 API 已返回公开摘要，页面应直接消费，避免两处入口展示不同结论。
- 修复：页面读取 `payload.summary`，在资源中心首页区块展示“当前公开 N 份”与
  前 3 个热门标签；加载失败时静默降级，不影响检索结果。
- 验收：匿名访问资源中心可见公开数量与标签；教师登录后摘要仍指全库公开数；
  检索功能不受摘要加载影响。

### R3-04 门户与权限文档一致性

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：README 把学生/家长只读门户写成已实现能力，实际服务端按教师管理员登录
  保护；权限原则没有明确“匿名只读公开资源”。
- 理由：文档与实现不一致会让维护者误判访问边界，也可能让公开 API 被当成
  学生/家长接口而错误暴露私人数据。
- 修复：
  1. README 增加“当前实现说明”，区分产品目标与当前实现。
  2. ARCHITECTURE 的 `/portal` 行同步修正。
  3. 权限原则补充匿名/公开请求只读公开资源，写操作要求教师或已授权助教。
- 验收：README 与 ARCHITECTURE 不再声称学生/家长登录已开放；权限表述与
  `app/api/resources` 等实现一致。

### R3-05 门禁与测试基线同步

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：新增 API 契约与首页/资源中心行为没有源码级回归测试，测试基线文档未更新。
- 理由：公开入口是安全敏感面，任何改动必须有可重复的门禁证据。
- 修复：
  1. 新增 `tests/public-resource-discovery.test.mjs`，覆盖 API scope/limit/
     summary、首页真实预览、资源中心摘要、样式与文档一致性。
  2. `docs/testing.md` 更新当前基线：277 项测试、e2e 14 个模块 53 项检查、
     119 API 全覆盖、323 项页面/API 探测。
- 验收：全量门禁通过后基线数字与真实运行输出一致。

## 5. 全量门禁验证（2026-08-07）

- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：构建成功，277 项测试全部通过（0 fail / 0 skipped，新增
  `public-resource-discovery.test.mjs` 5 项契约）。
- `pnpm teaching:e2e`：通过；14 个业务模块共 53 项检查，报告
  `outputs/teaching-loop-e2e.json`。
- `node scripts/surface-audit.mjs`：通过；29 页面 / 119 API / 323 探测 /
  0 异常，报告 `outputs/surface-audit.json`。
- `pnpm api:inventory -- --strict`：通过；119 API / 119 覆盖 / 0 未覆盖。
- `pnpm mini:production-guard`：通过；login/sync/me 均 503，零写入。

## 6. 后续建议（本轮未纳入）

- 学生/家长登录链路：`/portal` 目前按教师管理员登录保护；开放学生/家长角色需要
  独立的产品权限设计、监护人绑定与最小字段审计，不建议在公开资源修复中一并做。
- 热门标签全局化：当前 `popularTags` 来自公开结果行，若公开资源量变大，可改为
  对全量公开资源标签做定时聚合或独立统计接口。
- 公开资源详情页：当前首页与资源中心卡片均跳转 `/resources`，后续可增加匿名
  可见的公开详情页与“由教师主动分享”的稳定链接。
