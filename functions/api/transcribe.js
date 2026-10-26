// 音频转写代理 —— Key 存环境变量;前端上传 base64 WAV,后端转发 OpenRouter
const DEFAULT_MODEL = 'qwen/qwen3-asr-1.7b';
const LEGACY_MODEL = 'qwen/qwen3-asr-0.6b';

function checkPass(request, env) {
  if (!env.APP_PASS) return true;
  return request.headers.get('X-Moji-Pass') === env.APP_PASS;
}

export async function onRequestPost({ request, env }) {
  if (!checkPass(request, env)) return json({ error: '密码错误' }, 401);
  if (!env.OPENROUTER_KEY) return json({ error: '未配置 OPENROUTER_KEY 环境变量' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const audio = body?.audio;
  // 旧客户端仍可能提交 0.6b；服务端直接迁移到当前稳定版本。
  const requestedModel = body?.model || DEFAULT_MODEL;
  const model = requestedModel === LEGACY_MODEL ? DEFAULT_MODEL : requestedModel;
  // 校验 base64 WAV
  if (typeof audio !== 'string' || audio.length < 100 || audio.length > 6000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    return json({ error: '录音格式不正确,请重新录音' }, 400);
  }

  let lastStatus = 502;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Authorization': 'Bearer ' + env.OPENROUTER_KEY,
          'Content-Type': 'application/json',
          'HTTP-Referer': new URL(request.url).origin,
          'X-Title': 'MojiJournal'
        },
        // OpenRouter 当前 STT 文档只确认 model + input_audio，避免额外参数触发 provider 兼容问题。
        body: JSON.stringify({ model, input_audio: { data: audio, format: 'wav' } })
      });
      clearTimeout(timer);
      const raw = await res.text();
      if (res.ok) {
        return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }
      lastStatus = res.status;
      // 仅对临时上游错误重试；额度、鉴权、参数或模型错误应立即返回。
      if (![500, 502, 503, 504].includes(res.status)) break;
    } catch (e) {
      clearTimeout(timer);
      lastStatus = e?.name === 'AbortError' ? 504 : 502;
    }
  }

  const message = lastStatus === 429 ? '语音服务繁忙,请稍后重试'
    : lastStatus === 402 ? 'OpenRouter 余额不足或模型不可用'
    : lastStatus === 403 ? '语音服务权限或额度受限'
    : lastStatus === 404 ? '语音模型暂不可用'
    : lastStatus === 504 ? '转写超时,请缩短录音'
    : '语音服务上游失败,已自动重试,请稍后再试';
  return json({ error: message, code: `ASR_UPSTREAM_${lastStatus}`, retryable: [500, 502, 503, 504].includes(lastStatus) }, 502);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
