// AI 代理 —— Key 存 Cloudflare 环境变量 OPENROUTER_KEY,前端不再持有
// POST /api/ai  body: 透传给 OpenRouter 的 chat/completions 请求体
function checkPass(request, env) {
  if (!env.APP_PASS) return true;
  return request.headers.get('X-Moji-Pass') === env.APP_PASS;
}

export async function onRequestPost({ request, env }) {
  const started = Date.now();
  const suppliedId = request.headers.get('X-Moji-Request-Id') || '';
  const requestId = /^[a-zA-Z0-9_-]{8,80}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
  const diagnostic = { requestId, stage: 'request_validation', ray: request.headers.get('CF-Ray') || '' };
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Moji-Request-Id': requestId };
  const complete = (status, code) => {
    diagnostic.elapsedMs = Date.now() - started;
    diagnostic.httpStatus = status;
    // 只记录请求元数据,不记录账单原文、响应正文、密码和 API Key。
    console.info(JSON.stringify({ event: 'moji.ai', code, ...diagnostic }));
  };
  const fail = (status, code, error) => {
    complete(status, code);
    return new Response(JSON.stringify({ error, code, diagnostic }), { status, headers });
  };
  if (!checkPass(request, env)) return fail(401, 'AI_ACCESS_DENIED', '记账接口验证失败,请重新打开应用');
  if (!env.OPENROUTER_KEY) return fail(500, 'AI_CONFIG_MISSING', '服务器尚未配置模型服务密钥');
  let body;
  try { body = await request.json(); } catch { return fail(400, 'AI_REQUEST_INVALID', '记账请求格式错误'); }
  diagnostic.model = typeof body?.model === 'string' && /^[a-zA-Z0-9/._:-]{1,120}$/.test(body.model) ? body.model : '';
  const controller = new AbortController();
  let timedOut = false;
  // 包含等响应头和读正文,优先于客户端的 60 秒期限返回可定位的错误。
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
  try {
    diagnostic.stage = 'upstream_request';
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.OPENROUTER_KEY,
        'HTTP-Referer': new URL(request.url).origin,
        'X-Title': 'MojiJournal'
      },
      body: JSON.stringify(body)
    });
    diagnostic.upstreamStatus = res.status;
    diagnostic.upstreamRequestId = (res.headers.get('x-request-id') || '').slice(0,120);
    diagnostic.stage = 'upstream_body';
    const text = await res.text();
    diagnostic.stage = 'upstream_response';
    let payload;
    try { payload = JSON.parse(text); } catch {}
    if (!res.ok || payload?.error) {
      const embeddedStatus = Number(payload?.error?.code);
      const status = res.ok
        ? ([400,401,402,403,404,408,429,500,502,503,504].includes(embeddedStatus) ? embeddedStatus : 502)
        : res.status;
      const [code, message] = upstreamFailure(status);
      return fail(status, code, message);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return fail(502, 'AI_UPSTREAM_RESPONSE_INVALID', '模型服务返回了无法读取的数据,请稍后重试');
    }
    if (!diagnostic.upstreamRequestId && typeof payload.id === 'string') diagnostic.upstreamRequestId = payload.id.slice(0,120);
    complete(200, 'AI_OK');
    return new Response(text, { status: 200, headers });
  } catch {
    return timedOut
      ? fail(504, 'AI_UPSTREAM_TIMEOUT', '模型服务等待超过 45 秒,请稍后重试')
      : fail(502, 'AI_UPSTREAM_NETWORK', '服务器连接模型服务失败,请稍后重试');
  } finally {
    clearTimeout(timer);
  }
}

function upstreamFailure(status) {
  switch (status) {
    case 400: return ['AI_REQUEST_INVALID', '模型不接受当前请求参数'];
    case 401: return ['AI_UPSTREAM_AUTH', '服务器的模型服务密钥失效'];
    case 402: return ['AI_BALANCE', '模型服务余额不足,需要充值'];
    case 403: return ['AI_UPSTREAM_PERMISSION', '模型服务权限不足或请求被拒绝'];
    case 404: return ['AI_MODEL_UNAVAILABLE', '当前模型不可用,请更换模型'];
    case 429: return ['AI_RATE_LIMIT', '模型服务限流,请稍后重试'];
    case 408:
    case 504: return ['AI_UPSTREAM_TIMEOUT', '模型服务响应超时,请稍后重试'];
    default: return ['AI_UPSTREAM_FAILURE', '模型服务暂时出错,请稍后重试'];
  }
}
