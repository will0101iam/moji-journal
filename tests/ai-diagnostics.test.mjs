// 集成契约:真实前端请求链路 + Pages handler,注入各边界故障。
// node tests/ai-diagnostics.test.mjs
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const backend=readFileSync(new URL('../functions/api/ai.js',import.meta.url),'utf8');
const extract=name=>html.match(new RegExp(`^((?:async )?function ${name}\\([\\s\\S]*?^\\})`,'m'))?.[1];
const answer={choices:[{finish_reason:'stop',message:{content:JSON.stringify({
  items:[30,45,18,60].map(amount=>({amount:String(amount)}))
})}}]};
const reply=(json,status=200,headers={})=>new Response(JSON.stringify(json),{
  status,headers:{'Content-Type':'application/json',...headers}
});
function frontend(fetchImpl,{online=true,fastTimer=false}={}){
  const context=vm.createContext({
    fetch:fetchImpl,crypto:webcrypto,AbortController,Response,
    navigator:{onLine:online},document:{visibilityState:'visible'},
    getPass:()=>'test-pass',escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
    setTimeout:(fn,ms)=>setTimeout(fn,fastTimer?5:ms),clearTimeout
  });
  const constants=html.match(/^const AI_DIAGNOSTIC_VERSION=.*;$/m)?.[0]||'';
  const functions=['aiFailure','aiHTTPFailure','newAIDiagnostic','renderAIError',
    'callOR','readAIResponse','extractJSON','parseAccountJSON'].map(extract).filter(Boolean);
  vm.runInContext(constants+'\n'+functions.join('\n'),context);
  return context;
}
function server(fetchImpl,{fastTimer=false}={}){
  const logs=[];
  const context=vm.createContext({
    fetch:fetchImpl,crypto:webcrypto,AbortController,Request,Response,URL,
    console:{info:entry=>logs.push(JSON.parse(entry))},
    setTimeout:(fn,ms)=>setTimeout(fn,fastTimer?5:ms),clearTimeout
  });
  vm.runInContext(backend.replace('export async function','async function'),context);
  const invoke=async(body={model:'test-model',messages:[{role:'user',content:'private ledger'}]},opts={})=>{
    const request=new Request('https://test.invalid/api/ai',{
      method:'POST',headers:{
        'Content-Type':'application/json','X-Moji-Pass':opts.pass??'test-pass',
        'X-Moji-Request-Id':opts.id??'diagnostic-request-0001','CF-Ray':'ray-example'
      },body:JSON.stringify(body)
    });
    return context.onRequestPost({
      request,env:{APP_PASS:'test-pass',OPENROUTER_KEY:'private-api-key',...opts.env}
    });
  };
  return {invoke,logs};
}
const cases=[];
const test=(name,fn)=>cases.push({name,fn});
const fails=async(fn,code,stage)=>{
  await assert.rejects(fn,error=>{
    assert.equal(error.code,code);
    assert.ok(error.diagnostic.requestId);
    assert.ok(error.diagnostic.version);
    if(stage)assert.equal(error.diagnostic.stage,stage);
    return true;
  });
};

test('正常四笔结果不变;前端发送请求编号并关闭推理',async()=>{
  let sent;
  const app=frontend(async(url,init)=>{sent=init;return reply(answer);});
  assert.equal(JSON.parse(await app.callOR({model:'m',messages:[]})).items.length,4);
  assert.match(sent.headers['X-Moji-Request-Id'],/^[a-zA-Z0-9_-]{8,80}$/);
  assert.deepEqual(JSON.parse(sent.body).reasoning,{enabled:false});
});
test('离线立即报 AI_OFFLINE,不发送请求',async()=>{
  let sent=false;
  const app=frontend(async()=>{sent=true;},{online:false});
  await fails(()=>app.callOR({model:'m'}),'AI_OFFLINE','client_request');
  assert.equal(sent,false);
});
test('Safari Load failed 有 AI_NETWORK 和原始请求编号',async()=>{
  const app=frontend(async()=>{throw new TypeError('Load failed');});
  await fails(()=>app.callOR({model:'m'}),'AI_NETWORK','client_request');
});
test('收到响应头后连接断开,定位到 response_body 并保留 HTTP',async()=>{
  const app=frontend(async()=>({
    ok:true,status:200,headers:new Headers({'X-Moji-Request-Id':'server-request-0001'}),
    text:async()=>{throw new TypeError('Load failed');}
  }));
  await assert.rejects(()=>app.callOR({model:'m'}),error=>{
    assert.equal(error.code,'AI_NETWORK');
    assert.equal(error.diagnostic.stage,'response_body');
    assert.equal(error.diagnostic.httpStatus,200);
    assert.equal(error.diagnostic.requestId,'server-request-0001');
    return true;
  });
});
test('客户端等待超时有独立错误码',async()=>{
  const app=frontend(async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  }),{fastTimer:true});
  await fails(()=>app.callOR({model:'m'}),'AI_TIMEOUT','client_request');
});
test('客户端超时覆盖响应正文读取阶段',async()=>{
  const app=frontend(async(url,{signal})=>({
    ok:true,status:200,headers:new Headers(),
    text:()=>new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
    })
  }),{fastTimer:true});
  await fails(()=>app.callOR({model:'m'}),'AI_TIMEOUT','response_body');
});
test('401 门禁错误不同于网络错误',async()=>{
  const app=frontend(async()=>reply({error:'密码错误',code:'AI_ACCESS_DENIED'},401));
  await fails(()=>app.callOR({model:'m'}),'AI_ACCESS_DENIED','response_status');
});
test('模型 429 错误保留服务器阶段/耗时/编号',async()=>{
  const app=frontend(async()=>reply({
    error:'模型服务繁忙',code:'AI_RATE_LIMIT',
    diagnostic:{requestId:'server-request-0002',stage:'upstream_response',elapsedMs:42,upstreamStatus:429}
  },429));
  await assert.rejects(()=>app.callOR({model:'m'}),error=>{
    assert.equal(error.code,'AI_RATE_LIMIT');
    assert.equal(error.diagnostic.stage,'upstream_response');
    assert.equal(error.diagnostic.serverElapsedMs,42);
    assert.equal(error.diagnostic.upstreamStatus,429);
    return true;
  });
});
test('HTML/非 JSON 响应有独立错误,不向用户泄露原始响应',async()=>{
  const app=frontend(async()=>new Response('<html>private upstream detail</html>'));
  await fails(()=>app.callOR({model:'m'}),'AI_RESPONSE_INVALID','response_json');
});
test('截断输出定位到 model_output',async()=>{
  const app=frontend(async()=>reply({choices:[{finish_reason:'length',message:{content:''}}]}));
  await fails(()=>app.callOR({model:'m'}),'AI_OUTPUT_TRUNCATED','model_output');
});
test('空输出与非 JSON 账目分开定位',async()=>{
  const empty=frontend(async()=>reply({choices:[{message:{content:''}}]}));
  await fails(()=>empty.callOR({model:'m'}),'AI_EMPTY_OUTPUT','model_output');
  const invalid=frontend(async()=>reply({choices:[{message:{content:'not JSON'}}]}));
  await fails(()=>invalid.callOR({model:'m'},{}),'AI_ACCOUNT_JSON_INVALID','account_parse');
});
test('诊断界面展示编号并转义内容',async()=>{
  const app=frontend(async()=>{throw new TypeError('Load failed');});
  let error;
  try{await app.callOR({model:'m'});}catch(e){error=e;}
  error.diagnostic.model='<img src=x>';
  const rendered=app.renderAIError('记账失败',error);
  assert.match(rendered,/查看诊断详情/);
  assert.match(rendered,/AI_NETWORK/);
  assert.match(rendered,new RegExp(error.diagnostic.requestId));
  assert.ok(!rendered.includes('<img src=x>'));
  assert.ok(!rendered.includes('private ledger'));
});
test('后端成功/失败共享请求编号,日志没有账目或密钥',async()=>{
  const api=server(async()=>reply(answer,200,{'x-request-id':'provider-0001'}));
  const response=await api.invoke();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('X-Moji-Request-Id'),'diagnostic-request-0001');
  assert.deepEqual(await response.json(),answer);
  assert.equal(api.logs.length,1);
  assert.equal(api.logs[0].requestId,'diagnostic-request-0001');
  const logged=JSON.stringify(api.logs);
  assert.ok(!logged.includes('private ledger'));
  assert.ok(!logged.includes('private-api-key'));
  assert.ok(!logged.includes('test-pass'));
});
test('后端连接失败返回结构化 502',async()=>{
  const api=server(async()=>{throw new TypeError('upstream private error');});
  const response=await api.invoke();
  const body=await response.json();
  assert.equal(response.status,502);
  assert.equal(body.code,'AI_UPSTREAM_NETWORK');
  assert.equal(body.diagnostic.stage,'upstream_request');
  assert.ok(!JSON.stringify(api.logs).includes('upstream private error'));
});
test('后端超时返回结构化 504',async()=>{
  const api=server(async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  }),{fastTimer:true});
  const response=await api.invoke();
  assert.equal(response.status,504);
  assert.equal((await response.json()).code,'AI_UPSTREAM_TIMEOUT');
});
test('后端等响应正文时失败也能定位',async()=>{
  const api=server(async()=>({
    status:200,ok:true,headers:new Headers(),
    text:async()=>{throw new TypeError('body dropped');}
  }));
  const body=await (await api.invoke()).json();
  assert.equal(body.code,'AI_UPSTREAM_NETWORK');
  assert.equal(body.diagnostic.stage,'upstream_body');
  assert.equal(body.diagnostic.upstreamStatus,200);
});
test('额度、限流、模型错误独立分类',async()=>{
  for(const [status,code] of [[402,'AI_BALANCE'],[429,'AI_RATE_LIMIT'],[404,'AI_MODEL_UNAVAILABLE']]){
    const api=server(async()=>reply({error:{message:'private detail'}},status));
    const response=await api.invoke();
    assert.equal(response.status,status);
    assert.equal((await response.json()).code,code);
  }
});
test('HTTP 200 里的模型错误也能识别',async()=>{
  const api=server(async()=>reply({error:{code:429,message:'private detail'}}));
  const response=await api.invoke();
  assert.equal(response.status,429);
  assert.equal((await response.json()).code,'AI_RATE_LIMIT');
});
test('后端非 JSON 响应定位到模型返回内容异常',async()=>{
  const api=server(async()=>new Response('<html>private data</html>'));
  const response=await api.invoke();
  assert.equal(response.status,502);
  assert.equal((await response.json()).code,'AI_UPSTREAM_RESPONSE_INVALID');
});
test('拒绝鉴权失败,不调用上游;恶意编号不进入日志',async()=>{
  let sent=false;
  const api=server(async()=>{sent=true;});
  const response=await api.invoke(undefined,{pass:'wrong',id:'<script>bad</script>'});
  assert.equal(response.status,401);
  assert.equal((await response.json()).code,'AI_ACCESS_DENIED');
  assert.equal(sent,false);
  assert.ok(!JSON.stringify(api.logs).includes('<script>'));
});

let failures=0;
for(const {name,fn} of cases){
  try{await fn();console.log(`ok   ${name}`);}
  catch(error){failures++;console.log(`FAIL ${name}\n     ${error.message}`);}
}
console.log(`${cases.length-failures}/${cases.length} passed`);
process.exitCode=failures?1:0;
