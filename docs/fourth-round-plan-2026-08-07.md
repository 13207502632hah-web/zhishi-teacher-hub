# 知师研室第四轮公开资源详情与复核计划（2026-08-07）

> 复核人：Codex（本地静态盘点 + GitHub 公开项目实时检索 + 门禁基线复核）
> 范围：本轮补齐公开资源详情页、详情 API 的匿名只读边界、热门标签全量口径，
> 并同步动态路由审计、测试与文档。
> 前提：第一至第三轮计划已完成并部署；本轮不重复已完成的公开摘要、首页预览、
> 门户文档一致性等闭环。

## 1. 复核方法

1. 静态审读 `app/api/resources/route.ts`、`app/api/resources/[id]/route.ts`、
   `app/resources/page.tsx`、`app/resources/[id]/page.tsx`、`AppShell.tsx`、
   `README.md` 与 `ARCHITECTURE.md`，核验公开资源详情、匿名边界与文档路由。
2. 通过 GitHub REST API 实时核对同类教育/学校管理、题库组卷、资源门户项目的
   star、语言与描述，作为公开资源体验与权限设计的对照。
3. 与现有门禁对照：`pnpm typecheck`、`pnpm lint`、`pnpm test`、
   `pnpm teaching:e2e`、`node scripts/surface-audit.mjs`、
   `pnpm api:inventory -- --strict`、`pnpm mini:production-guard`。

## 2. GitHub 同类项目对照（2026-08-07 实时核对）

| 项目 | star | 技术栈 | 对照启示 |
| --- | --- | --- | --- |
| frappe/lms | 3114 | Python | 学习管理系统：公开课程目录、内容详情与登录后管理分离；公开资源应有稳定详情页而不是只有列表 |
| edusoho/edusoho | 1859 | PHP | 在线教育：公开内容与私有班级/课程边界清晰，详情页承担“先看内容、再决定登录”的转化 |
| school-management-system | 1131 | Blade/Laravel | 学校管理：教师、学生、家长多角色入口分离；匿名公开页不得携带私人教学信息 |
| lav_sms | 1015 | PHP/Laravel | 学校管理：角色化菜单与隐私最小展示；公开首页与资源中心应保持服务端权限核验 |
| pupilfirst/pupilfirst | 974 | Ruby | LMS：稳定公开分享链接与匿名浏览是资源沉淀的基础能力 |
| rosariosis | 642 | PHP | 学校管理：课程资料目录可公开浏览，资料详情独立路由 |
| MERN-School-Management-System | 637 | MERN | 管理端与公开入口分离：列表、详情、权限提示需要一致 |
| frappe/education | 591 | Python | 教育 ERP：教师工作台与门户分离，权限矩阵完整；公开资源详情应只暴露教师主动公开字段 |
| openSIS-Classic | 333 | PHP | 学校管理：公开/私有内容按角色可见，详情接口不泄露私有记录存在性 |
| wanyue_online_education_uniapp | 60 | Uniapp | 在线教育：资源列表与详情路径稳定，移动端优先 |
| HUHEMS | 56 | JavaScript | 教育管理：公开资源目录与详情边界，匿名访问体验应可解释 |

### 2.1 对照结论

成熟项目普遍具备：公开目录/资源列表、稳定的内容详情路由、匿名只读与登录管理
分离、服务端不泄露私有内容存在性。本站此前首页与资源列表只能跳回资源中心，
没有详情页；详情 API 只有删除方法，匿名访问会被统一当成私有 API 拒绝。本轮
据此补齐“匿名可读公开资源详情”的闭环，并把热门标签改为全量公开资源聚合，
避免列表分页后摘要失真。

## 3. 现状复核结果

### 3.1 公开资源详情页缺失

- 首页公开资源卡片与资源中心卡片此前都链接回 `/resources`，访客无法直接查看
  某一篇公开资源的完整内容，也无法复制稳定分享链接。
- 修复后：新增 `/resources/[id]` 客户端详情页，支持加载中、404、错误、就绪
  四种状态；展示标题、类型、标签、内容、来源与安全外链；提供复制分享链接和
  返回公开资源中心。

### 3.2 详情 API 只有删除，没有匿名只读契约

- `GET /api/resources/[id]` 此前不存在；新增后匿名用户只能读取
  `visibility=public` 的资源，私有资源对匿名用户返回 404，不泄露存在性。
- 有 `resources:private` 权限的教师/助教可读取私有资源；`DELETE` 仍要求
  `resources:write`，匿名删除返回 401。

### 3.3 热门标签只从当前结果行聚合

- 列表接口的 `popularTags` 此前基于当前返回行，分页或搜索后会失真。
- 修复后：单独查询全量公开资源的 `tags` 列再聚合，与 `summary.publicCount`
  一样是全库口径。

### 3.4 动态路由未进入审计门禁

- `surface-audit.mjs` 的公开页面判断只认 `/resources`，详情页会被当成私有页面；
  详情 API 同时有 GET/DELETE，无法套用单一“公开或私有”预期。
- 修复后：详情页匿名访问允许 200；详情 API 单独探测 GET 匿名/登录与 DELETE
  匿名/登录四类契约。

## 4. 详细计划单

### R4-01 公开资源详情页

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：公开资源没有独立详情路由，访客无法沉淀稳定分享链接。
- 理由：GitHub 对照中的教育/资源项目都提供公开内容详情；没有详情页，公开资源
  只能停留在“列表可检索”，无法承担分享、收藏和后续教研沉淀。
- 修复：
  1. 新增 `app/resources/[id]/page.tsx`，通过 `useParams` 读取资源 id。
  2. 调用 `GET /api/resources/[id]`，区分 loading / missing(404) / error /
     ready 状态，404 不显示“无权限”而显示“不存在或未公开”。
  3. 展示公开边界文案，强调不包含学生、家长或私人教学信息。
  4. 支持复制分享链接、返回公开资源中心、安全外链新标签页打开。
- 验收：匿名访问有效公开资源详情可见内容；访问私有资源或非法 id 显示
  “不存在或未公开”；复制链接可用；外链仅允许 http/https 并带
  `noopener noreferrer`。

### R4-02 详情 API 匿名只读与删除鉴权

- 状态：已完成（2026-08-07）
- 优先级：P1
- 现状：`app/api/resources/[id]/route.ts` 只有 DELETE，没有公开读取入口。
- 理由：详情页需要服务端做权限核验，不能只靠前端隐藏；匿名读取私有资源应等同
  “不存在”，避免枚举和泄露。
- 修复：
  1. 新增 `GET`：非法 id 返回 404；匿名只查 `visibility=public`；教师或持有
     `resources:private` 的助教可查私有资源。
  2. `GET` 返回 `canManage`，用于详情页后续管理态扩展，不影响匿名边界。
  3. `DELETE` 保持 `resources:write` 权限要求，匿名返回 401。
- 验收：匿名 GET 公开资源 200、私有资源 404；登录教师 GET 私有资源 200；
  匿名 DELETE 401；登录教师 DELETE 走原 404/成功语义。

### R4-03 热门标签全量口径

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：`popularTags` 从当前结果行聚合，分页或搜索后标签摘要失真。
- 理由：公开摘要应是“全库公开资源”的稳定目录信息；依赖结果行会让同一页面在
  不同查询下给出矛盾的热门标签。
- 修复：新增 `publicTagRows` 查询，对全量公开资源的 `tags` 拆分、去空格、计数后
  取前 8；不再使用 `rows.flatMap`。
- 验收：任意 `q`、`scope`、`limit` 组合下，`popularTags` 均来自全量公开资源；
  现有公开首页与资源中心摘要继续一致。

### R4-04 门禁、测试与文档同步

- 状态：已完成（2026-08-07）
- 优先级：P2
- 现状：详情页、详情 API、动态路由审计和路由文档均未同步。
- 理由：安全敏感面必须有可重复的回归证据；README/ARCHITECTURE 路由表也要与
  实际页面一致。
- 修复：
  1. 新增 `tests/public-resource-detail.test.mjs`，覆盖页面状态、公开边界、
     安全外链、分享链接、AppShell 路由判断、列表/首页链接与 API 权限契约。
  2. `resources-redesign.test.mjs` 与 `public-resource-discovery.test.mjs`
     补充 GET 契约与全量标签口径断言。
  3. `surface-audit.mjs` 增加 `/resources/[id]` 公开页面分支与
     `/api/resources/[id]` 四类 API 探测。
  4. `README.md`、`ARCHITECTURE.md`、`docs/testing.md` 同步资源详情路由与
     测试说明。
- 验收：全量门禁通过后，新增 API 有测试引用；动态详情页匿名探测不再误报；
  文档路由与实际一致。

## 5. 全量门禁验证（2026-08-07）

- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm test`：通过，287 项全部通过（0 fail / 0 skipped）。
- `pnpm teaching:e2e`：通过，AI 隐私/学习/题库审核完整链路 1 轮、教学闭环
  2 轮，业务级覆盖 14 个模块共 53 项检查。
- `node scripts/surface-audit.mjs`：通过，30 个页面、119 个 API 路由、
  328 项检查，0 异常。
- `pnpm api:inventory -- --strict`：通过，119 个 API 全部有测试/脚本引用，
  0 未覆盖。
- `pnpm mini:production-guard`：通过，生产环境 login/sync/me 均返回
  503 MINI_FEATURE_DISABLED，无数据写入。

## 6. 后续建议（本轮未纳入）

- 教师管理态详情：详情 API 已返回 `canManage`，后续可在详情页增加登录教师的
  编辑/删除入口，但本轮保持匿名优先，不做管理态扩散。
- 分享访问统计：可后续增加公开详情页 PV 与来源统计，但需要单独设计隐私口径，
  不建议记录访客个人身份。
- 公开资源全文检索：目前仍为 SQL LIKE，资源量增大后可改为 D1 FTS5 或独立索引，
  属于性能增强，不改变本轮权限边界。
