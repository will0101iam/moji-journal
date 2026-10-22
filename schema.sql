-- 墨记同步表:文档型存储,每行 = 一条记录(交易/账户/分类/预算/目标)
-- user 维度隔离(来自 Cloudflare Access 登录邮箱),单人也适用
CREATE TABLE IF NOT EXISTS records (
  user      TEXT NOT NULL,              -- 所属用户(Access 邮箱)
  store     TEXT NOT NULL,              -- 对象类型:transactions/accounts/categories/budgets/goals
  id        TEXT NOT NULL,              -- 记录自身 id
  data      TEXT NOT NULL,              -- 记录 JSON 序列化
  updatedAt INTEGER NOT NULL,           -- 最后修改时间戳(毫秒),用于 last-write-wins
  deleted   INTEGER NOT NULL DEFAULT 0, -- 软删除墓碑:1=已删
  PRIMARY KEY (user, store, id)
);

-- 按 user + 修改时间检索,支撑增量下行拉取
CREATE INDEX IF NOT EXISTS idx_records_sync ON records (user, updatedAt);
