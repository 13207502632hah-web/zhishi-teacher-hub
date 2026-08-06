# D1 备份与恢复

项目主数据库是 Cloudflare D1：本地开发使用 Miniflare 生成的 SQLite 文件，
线上数据位于远程 D1。备份分三层：本地文件复制、`wrangler d1 export/execute`
导出的 SQL、设置页 JSON 导出。教学记录、结算记录与演示数据都在备份范围内。

## 本地备份

本地 D1 位于 `.wrangler/state/v3/d1/`。备份前先停止 `pnpm dev`，避免文件
写入冲突：

```bash
# 停止 dev 后复制整个 D1 状态目录
cp -R .wrangler/state/v3/d1 .wrangler/state/v3/d1.bak-2026-08-06
```

Windows 下可用 `Copy-Item -Recurse` 或直接复制目录。也可以只复制其中的
`*.sqlite` 主文件，Miniflare 的 SQLite 是单文件数据库。恢复时把备份目录
复制回 `.wrangler/state/v3/d1/`，然后执行：

```bash
pnpm db:init
pnpm dev
```

## 远程 D1 备份

需要已登录 wrangler，且项目绑定的 D1 数据库名为 `DB`：

```bash
pnpm exec wrangler d1 export DB --remote --output backups/zhishi-2026-08-06.sql
```

恢复会覆盖目标库当前数据，务必先导出当前库：

```bash
pnpm exec wrangler d1 execute DB --remote --file backups/zhishi-2026-08-06.sql
```

## 本地 SQL 导出与恢复

本地库同样可以用 SQL 文件导出，便于存档或迁移到其他环境：

```bash
pnpm exec wrangler d1 export DB --local --output backups/local-2026-08-06.sql
pnpm exec wrangler d1 execute DB --local --file backups/local-2026-08-06.sql
```

恢复本地库前先停止 dev 服务，恢复后运行 `pnpm db:init` 校验必需表。

## 设置页 JSON 导出

设置页“数据导出”调用 `GET /api/settings/export`，提供业务层 JSON 备份，
可作为文件复制的补充。导出包含业务记录与演示数据，不包含任何密钥。

## 恢复演练与验收

1. 导出当前库：`wrangler d1 export ... --output before.sql`。
2. 执行恢复：`wrangler d1 execute ... --file before.sql`，或复制本地文件。
3. 用教师管理员账号登录，检查工作台、课时、题库、结算各打开一次。
4. 抽查一条演示记录：应有“【演示】”标记；不需要时可在设置页一键清除。

注意事项：

- 远程 `d1 execute --file` 会覆盖目标 D1，执行前必须确认数据库名与备份文件，
  建议先在本地演练。
- 备份文件包含演示数据，恢复到其他环境后应先清除演示数据或使用独立环境。
- `.wrangler/` 已在 `.gitignore` 中，不要把本地 SQLite 或 SQL 备份提交进仓库。
