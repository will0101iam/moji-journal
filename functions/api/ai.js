// AI 代理 —— Key 存 Cloudflare 环境变量 OPENROUTER_KEY,前端不再持有
// POST /api/ai  body: 透传给 OpenRouter 的 chat/completions 请求体
function checkPass(request, env) {
  if (!env.APP_PASS) return true;
  return request.headers.get('X-Moji-Pass') === env.APP_PASS;
}

export async function onRequestPost({ request, env }) {
  if (!checkPass(request, env)) return json({ error: '密码错误' }, 401);
  if (!env.OPENROUTER_KEY) return json({ error: '未配置 OPENROUTER_KEY 环境变量' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.OPENROUTER_KEY,
      'HTTP-Referer': new URL(request.url).origin,
      'X-Title': 'MojiJournal'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
