// 墨记同步接口 —— 本地优先 + last-write-wins 双向同步
// POST /api/sync  body: { since: number, changes: [{store,id,data,updatedAt,deleted}] }
// 返回: { now: number, records: [{store,id,data,updatedAt,deleted}] }  // 服务端 updatedAt > since 的记录

function userOf(request) {
  // Cloudflare Access 登录后会注入此 header;没有 Access 时回退单用户
  return request.headers.get('Cf-Access-Authenticated-User-Email') || 'local';
}

const STORES = new Set(['transactions', 'accounts', 'categories', 'budgets', 'goals']);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'D1 未绑定(检查 Pages 设置里的 DB 绑定)' }, 500);
  const user = userOf(request);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const since = Number(body.since) || 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];

  // 1) 上行:逐条 LWW upsert —— 仅当客户端 updatedAt 严格更新时才覆盖
  for (const c of changes) {
    if (!STORES.has(c.store) || !c.id) continue;
    const upd = Number(c.updatedAt) || Date.now();
    const data = typeof c.data === 'string' ? c.data : JSON.stringify(c.data ?? {});
    const del = c.deleted ? 1 : 0;
    await env.DB.prepare(
      `INSERT INTO records (user, store, id, data, updatedAt, deleted)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(user, store, id) DO UPDATE SET
         data=excluded.data, updatedAt=excluded.updatedAt, deleted=excluded.deleted
       WHERE excluded.updatedAt > records.updatedAt`
    ).bind(user, c.store, c.id, data, upd, del).run();
  }

  // 2) 下行:返回服务端比 since 更新的记录(含墓碑,供客户端删除本地)
  const { results } = await env.DB.prepare(
    `SELECT store, id, data, updatedAt, deleted FROM records
     WHERE user = ?1 AND updatedAt > ?2 ORDER BY updatedAt ASC`
  ).bind(user, since).all();

  return json({ now: Date.now(), records: results || [] });
}

// 预检/诊断:GET 返回当前用户与记录数
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'D1 未绑定' }, 500);
  const user = userOf(request);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM records WHERE user = ?1 AND deleted = 0`
  ).bind(user).first();
  return json({ user, count: row ? row.n : 0 });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
