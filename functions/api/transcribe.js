// 音频转写代理 —— Key 存环境变量;前端上传 base64 WAV,后端带 language/temperature 转发 OpenRouter
// 改造要点(对齐高识别率做法):input_audio{data,format:'wav'} + language:'Chinese' + temperature:0
function checkPass(request, env) {
  if (!env.APP_PASS) return true;
  return request.headers.get('X-Moji-Pass') === env.APP_PASS;
}

export async function onRequestPost({ request, env }) {
  if (!checkPass(request, env)) return json({ error: '密码错误' }, 401);
  if (!env.OPENROUTER_KEY) return json({ error: '未配置 OPENROUTER_KEY 环境变量' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const audio = body?.audio, model = body?.model || 'qwen/qwen3-asr-0.6b';
  // 校验 base64 WAV
  if (typeof audio !== 'string' || audio.length < 100 || audio.length > 6000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    return json({ error: '录音格式不正确,请重新录音' }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST', signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + env.OPENROUTER_KEY,
        'Content-Type': 'application/json',
        'HTTP-Referer': new URL(request.url).origin,
        'X-Title': 'MojiJournal'
      },
      body: JSON.stringify({ model, input_audio: { data: audio, format: 'wav' }, language: 'Chinese', temperature: 0 })
    });
  } catch (e) {
    clearTimeout(timer);
    return json({ error: e?.name === 'AbortError' ? '转写超时,请缩短录音' : '语音服务暂不可用' }, 502);
  }
  clearTimeout(timer);

  const raw = await res.text();
  if (!res.ok) {
    return json({ error: res.status === 429 ? '语音服务繁忙,请稍后重试' : res.status === 402 ? 'OpenRouter 余额不足或模型不可用' : '语音识别服务暂不可用' }, 502);
  }
  // 原样返回(前端取 .text)
  return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
