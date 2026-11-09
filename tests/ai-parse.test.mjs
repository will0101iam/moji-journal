// 回归测试:用真实生产 OpenRouter 响应驱动 index.html 中的真实解析代码。
// 运行:node tests/ai-parse.test.mjs
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const root=fileURLToPath(new URL('..',import.meta.url));
const html=readFileSync(root+'index.html','utf8');

function source(name){
  const match=html.match(new RegExp(`^((?:async )?function ${name}\\([\\s\\S]*?^\\})`,'m'));
  assert.ok(match,`index.html 缺少 ${name}`);
  return match[1];
}

const sent=[];
const context=vm.createContext({
  crypto:webcrypto,AbortController,Response,setTimeout,clearTimeout,
  navigator:{onLine:true},document:{visibilityState:'visible'},
  getPass:()=>'',
  fetch:async(url,init)=>{
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"items":[]}'}}]}));
  }
});
vm.runInContext(html.match(/^const AI_DIAGNOSTIC_VERSION=.*;$/m)[0]+'\n'+
  ['aiFailure','aiHTTPFailure','newAIDiagnostic','callOR','readAIResponse','extractJSON'].map(source).join('\n'),context);
const callOR=body=>context.callOR(body);
const readAIResponse=json=>context.readAIResponse(json);
const extractJSON=text=>context.extractJSON(text);
const fixture=name=>JSON.parse(readFileSync(`${root}tests/fixtures/${name}.json`,'utf8'));
const itemCount=text=>{
  const parsed=extractJSON(text);
  return Array.isArray(parsed?.items)?parsed.items.length:parsed?.amount!=null?1:0;
};

const cases=[];
const test=(name,fn)=>cases.push({name,fn});

test('推理过程里的单笔草稿不会覆盖最终 4 笔结果',()=>{
  assert.equal(itemCount(readAIResponse(fixture('ai-reasoning-collapses-to-one'))),4);
});

test('推理过程里的分类候选不会把 4 笔解析成 0 笔',()=>{
  assert.equal(itemCount(readAIResponse(fixture('ai-reasoning-drops-all'))),4);
});

test('正常 3 笔响应保持 3 笔',()=>{
  assert.equal(itemCount(readAIResponse(fixture('ai-clean-three'))),3);
});

test('推理耗尽输出预算时明确报错而不是静默少记',()=>{
  assert.throws(()=>readAIResponse(fixture('ai-reasoning-exhausts-budget')),/输出被截断/);
});

test('只有推理没有正文时明确报错',()=>{
  assert.throws(()=>readAIResponse({choices:[{finish_reason:'stop',message:{content:'',reasoning:'{"amount":"4"}'}}]}),/模型无返回/);
});

test('所有拆账请求(含截图识别)都关闭推理',async()=>{
  sent.length=0;
  await callOR({model:'m',messages:[{role:'user',content:[{type:'text',text:'识别小票'}]}],max_tokens:3000});
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].reasoning)),{enabled:false});
});

let failed=0;
for(const {name,fn} of cases){
  try{await fn();console.log(`ok   ${name}`);}
  catch(error){failed++;console.log(`FAIL ${name}\n     ${error.message}`);}
}
console.log(`${cases.length-failed}/${cases.length} passed`);
process.exit(failed?1:0);
