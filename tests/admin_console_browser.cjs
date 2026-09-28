'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('./playwright.cjs');
const root=path.join(__dirname,'../web');
const out=path.join(__dirname,'../outputs/admin-review-20260917');
const fixture=()=>({revision:1,settings:{requireLogin:true,maintenance:false,notice:{enabled:false,title:'',body:''}},history:[{at:'2026-09-17T02:00:00Z',actor:'test-admin',action:'settings',detail:{requireLogin:true}}],account:{username:'test-admin',canChangePassword:true},version:'2026-09-14.2',uptime:3750,catalog:{demons:275,skills:349},loginPolicy:{revision:1,settings:{sessionMinutes:31,inactivityMinutes:13,rememberMinutes:61,rememberMeEnabled:true,rememberMeDefault:false,rememberPasswordEnabled:true},history:[]},turnstile:{revision:1,settings:{enabled:false,siteKey:'',theme:'auto',appearance:'interaction-only'},secretConfigured:false,history:[]},jobs:{mode:'remote',computeSlots:4,workers:[{name:'worker-a',slots:2,onlineSlots:2,running:1},{name:'worker-b',slots:2,onlineSlots:2,running:0}],capacity:64,counts:{running:1,queued:0,completed:1,cancelled:0,failed:0},items:[{id:'running-fixture',label:'亚略',status:'running',stage:'正在搜索合体与灵体路线',seconds:61,canCancel:true},{id:'complete-fixture',label:'天使',status:'completed',stage:'三种方案已就绪',seconds:2,canCancel:false}]}});
async function run(){
 await fs.mkdir(out,{recursive:true});
 const server=http.createServer(async(req,res)=>{
  let name=new URL(req.url,'http://127.0.0.1').pathname;if(name==='/admin/')name='/admin/index.html';
  const filename=path.resolve(root,'.'+decodeURIComponent(name));
  if(!filename.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  try{const data=await fs.readFile(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(filename)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({args:['--no-sandbox','--no-proxy-server']});
 const errors=[],checks=[];let page;
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  let data=fixture(),overviewStatus=200,savedPolicy,saveCount=0,turnstileWrites=0;
  await context.route('**/api/admin/**',async route=>{
   const req=route.request(),endpoint=new URL(req.url()).pathname.split('/').at(-1),body=req.method()==='POST'?req.postDataJSON():null;
   if(endpoint==='overview')return route.fulfill({status:overviewStatus,json:overviewStatus===200?structuredClone(data):{error:'模拟会话失效或网络故障'}});
   if(endpoint==='login-policy'){
    savedPolicy=body;saveCount++;data.loginPolicy={...data.loginPolicy,revision:data.loginPolicy.revision+1,settings:{...data.loginPolicy.settings,...body.patch}};
    return route.fulfill({json:structuredClone(data.loginPolicy)});
   }
   if(endpoint==='settings'){
    if(body.revision!==data.revision)return route.fulfill({status:409,json:{error:'设置已在其他页面更新'}});
    data.settings={...data.settings,...body.patch};data.revision++;return route.fulfill({json:{revision:data.revision,settings:data.settings,history:data.history}});
   }
   if(endpoint==='turnstile'){
    turnstileWrites++;
    if(body.revision!==data.turnstile.revision)return route.fulfill({status:409,json:{error:'设置已在其他页面更新'}});
    return route.fulfill({status:503,json:{error:'模拟保存失败'}});
   }
   if(endpoint==='cancel'){data.jobs.items[0].canCancel=false;data.jobs.items[0].status='cancelled';return route.fulfill({json:{cancelled:true}});}
   throw Error('Unexpected admin request '+endpoint);
  });
  let releaseScript,scriptStarted;const started=new Promise(r=>scriptStarted=r),gate=new Promise(r=>releaseScript=r);
  await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',async route=>{
   scriptStarted();await gate;
   await route.fulfill({contentType:'text/javascript',body:`window.widgetCalls=[];window.removedWidgets=[];window.turnstile={render(selector,options){const id=String(widgetCalls.length);widgetCalls.push({id,options});return id;},remove(id){removedWidgets.push(id);},reset(){}};`});
  });
  const ready=()=>page.waitForFunction(()=>document.querySelector('#health').textContent==='运行正常');
  const refresh=async()=>{await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);};
  await page.goto(base+'/admin/');await ready();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('data-skin'),'smtv');
  assert.match(await page.locator('#queue-summary').innerText(),/worker-a：2\/2 在线/);
  assert.match(await page.locator('#queue-summary').innerText(),/主站不执行计算/);
  assert.match(await page.locator('#session-duration-hint').innerText(),/31 分钟/);
  await page.locator('#remember-password-enabled').uncheck();await page.locator('#save-login-policy').click();
  await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('登录设置已保存'));
  assert.equal(savedPolicy.patch.sessionMinutes,31);assert.equal(savedPolicy.patch.rememberMinutes,61);assert.equal(savedPolicy.patch.inactivityMinutes,13);
  await page.locator('#session-hours').fill('0.333');await page.locator('#save-login-policy').click();assert.equal(saveCount,1,'genuine fractional minutes must be rejected');
  await page.locator('#discard-login-policy').click();checks.push('exact-minute duration values survive unit conversion while fractional minutes are rejected');

  await page.locator('#notice-title').fill('尚未发布的公告草稿');await page.locator('#notice-body').fill('草稿内容\n第二行');
  overviewStatus=401;await refresh();assert(await page.locator('#session-error').isVisible());assert(await page.locator('#notice-body').isDisabled());
  overviewStatus=200;await refresh();assert.equal(await page.locator('#notice-title').inputValue(),'尚未发布的公告草稿');assert(await page.locator('#session-error').isHidden());
  overviewStatus=503;await refresh();assert.equal(await page.locator('#notice-body').inputValue(),'草稿内容\n第二行');overviewStatus=200;await refresh();
  data.settings.notice={enabled:true,title:'另一管理员已发布',body:'已发布公告'};data.revision++;
  await refresh();assert.match(await page.locator('#notice-state').innerText(),/其他页面/);
  await page.locator('#save-notice').click();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('其他页面'));
  assert.equal(await page.locator('#notice-title').inputValue(),'尚未发布的公告草稿');
  const fb=await page.locator('#feedback').boundingBox();assert(fb.y>=0&&fb.y+fb.height<=1050,'save feedback is visible from a lower form');
  await page.locator('#dismiss-feedback').click();await page.locator('#discard-notice').click();
  assert.equal(await page.locator('#notice-title').inputValue(),'另一管理员已发布');
  checks.push('expired sessions, failed refresh and edit conflicts preserve drafts; save feedback remains visible');

  await page.locator('#turnstile-site-key').fill('site-key-a');await started;
  await page.locator('#turnstile-site-key').fill('site-key-b');
  await page.waitForTimeout(400);releaseScript();
  await page.waitForFunction(()=>window.widgetCalls?.length===1);
  assert.deepEqual(await page.evaluate(()=>widgetCalls.map(c=>c.options.sitekey)),['site-key-b']);
  await page.locator('#turnstile-site-key').fill('');await page.waitForFunction(()=>document.querySelector('#turnstile-preview').hidden);
  await page.evaluate(()=>widgetCalls[0].options.callback('stale-token'));
  await page.locator('#turnstile-site-key').fill('site-key-c');await page.waitForFunction(()=>widgetCalls.length===2);
  await page.locator('#turnstile-enabled').check();await page.locator('#save-turnstile').click();assert.equal(turnstileWrites,0,'old widget token must not authorize new key');
  await page.locator('input[name="turnstile-theme"][value="dark"]').check();
  await page.locator('input[name="turnstile-appearance"][value="always"]').check();
  await page.waitForFunction(()=>widgetCalls.at(-1).options.theme==='dark'&&widgetCalls.at(-1).options.appearance==='always');
  await page.evaluate(()=>widgetCalls.at(-1).options['error-callback']());assert(await page.locator('#retry-turnstile-preview').isVisible());
  const before=await page.evaluate(()=>widgetCalls.length);await page.locator('#retry-turnstile-preview').click();await page.waitForFunction(count=>widgetCalls.length===count+1,before);
  await page.evaluate(()=>widgetCalls.at(-1).options.callback('new-valid-test-token'));
  await page.locator('#save-turnstile').click();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('模拟保存失败'));
  assert.equal(turnstileWrites,1);assert.equal(await page.locator('#turnstile-secret-key').inputValue(),'');
  await page.locator('#discard-turnstile').click();
  data.turnstile={revision:5,settings:{enabled:true,siteKey:'configured-site-key',theme:'auto',appearance:'interaction-only'},secretConfigured:true,history:[]};await refresh();
  await page.locator('input[name="turnstile-theme"][value="light"]').check();
  data.turnstile.revision=6;await refresh();assert.match(await page.locator('#turnstile-config-state').innerText(),/其他页面/);
  await page.locator('#save-turnstile').click();await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('其他页面'));
  assert.equal(turnstileWrites,2,'secret-only concurrent update uses original revision and conflicts');
  await page.locator('#discard-turnstile').click();await page.locator('#dismiss-feedback').click();
  checks.push('Turnstile ignores stale async renders and tokens, previews selected settings, retries failures and detects secret rotations');

  await page.locator('#current-password').fill('test-current');await page.locator('#new-password').fill('password-example-1');await page.locator('#confirm-password').fill('password-example-2');await page.locator('#save-password').click();assert.match(await page.locator('#password-feedback').innerText(),/不一致/);
  await page.locator('#show-password').click();assert.equal(await page.locator('#new-password').getAttribute('type'),'text');await page.locator('#show-password').click();await page.locator('#password-form').evaluate(f=>f.reset());
  await page.locator('[data-cancel]').click();await page.waitForFunction(()=>!document.querySelector('[data-cancel]'));await page.locator('#dismiss-feedback').click();
  checks.push('password mismatch blocks submission; task cancellation updates the list');
  const layouts=[];
  for(const theme of ['light','dark'])for(const font of ['standard','large'])for(const width of [320,390,768,1024,1440]){
   await page.evaluate(({theme,font})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.font=font;}, {theme,font});await page.setViewportSize({width,height:1050});
   const metrics=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,clipped:[...document.querySelectorAll('h1,h2,h3,button,.setting-row,.field,.page-heading')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className)}));
   assert.equal(metrics.overflow,false,JSON.stringify({theme,font,...metrics}));assert.deepEqual(metrics.clipped,[],JSON.stringify({theme,font,...metrics}));layouts.push({theme,font,width});
  }
  await page.setViewportSize({width:390,height:1050});await page.locator('a[href="#history"]').click();await page.waitForFunction(()=>document.querySelector('nav a[aria-current]')?.hash==='#history');
  assert(await page.locator('#history').evaluate(e=>e.getBoundingClientRect().top>=parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)-2));
  checks.push('20 responsive theme/font layouts and mobile directory navigation without page overflow');
  for(const [name,theme,width]of [['desktop','light',1440],['dark','dark',1440],['mobile','light',390]]){
   await page.setViewportSize({width,height:1050});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.font='standard';scrollTo(0,0);},theme);
   await page.screenshot({path:path.join(out,name+'.png'),fullPage:name==='mobile'});
  }
  await page.locator('#theme').click();await page.locator('#font').click();await page.reload();await ready();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.locator('html').getAttribute('data-font'),'large');
  assert.deepEqual(errors,[]);const record={ok:true,checks,layouts:layouts.length,productionMutations:false};await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
 }catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
