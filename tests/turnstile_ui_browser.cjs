'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('./playwright.cjs');

const ROOT = path.resolve(__dirname, '../web');
const TEST_SITE_KEY = '1x00000000000000000000AA';
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
  '.webp':'image/webp','.woff2':'font/woff2'};

async function run() {
  const requests = {challenge:0,firstfactor:0};
  const server = http.createServer(async (request,response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST') for await (const _ of request) {}
    if (url.pathname === '/api/login/options') return json(response,{revision:0,settings:{sessionMinutes:1440,inactivityMinutes:720,rememberMinutes:43200,rememberMeEnabled:true,rememberMeDefault:false,rememberPasswordEnabled:true},turnstile:{enabled:true,siteKey:TEST_SITE_KEY,theme:'auto',appearance:'interaction-only'}});
    if (url.pathname === '/auth/api/state') return json(response,{data:{authentication_level:0}});
    if (url.pathname === '/api/login/turnstile') {requests.challenge++;return json(response,{verified:true,required:true},{'Set-Cookie':'smtvv_turnstile=test; Path=/auth/api/firstfactor; HttpOnly; SameSite=Strict'});}
    if (url.pathname === '/auth/api/firstfactor') {requests.firstfactor++;return json(response,{error:'账号或密码不正确，请重新输入。'},null,401);}
    if (url.pathname === '/api/admin/overview') return json(response,{revision:1,settings:{requireLogin:true,maintenance:false,notice:{enabled:false,title:'',body:''}},history:[],account:{username:'test-admin',group:'admins',canChangePassword:true},loginPolicy:{revision:0,settings:{sessionMinutes:1440,inactivityMinutes:720,rememberMinutes:43200,rememberMeEnabled:true,rememberMeDefault:false,rememberPasswordEnabled:true},history:[]},turnstile:{revision:1,settings:{enabled:true,siteKey:TEST_SITE_KEY,theme:'auto',appearance:'always'},secretConfigured:true,history:[]},version:'test',uptime:42,catalog:{demons:275,skills:311},jobs:{items:[],counts:{running:0,queued:0,completed:0,cancelled:0,failed:0},capacity:24}});
    let name = url.pathname;
    if (name === '/auth/' || name === '/auth') name = '/auth/index.html';
    if (name === '/admin/' || name === '/admin') name = '/admin/index.html';
    const filename = path.resolve(ROOT, '.' + decodeURIComponent(name));
    if (!filename.startsWith(ROOT + path.sep)) {response.writeHead(404);return response.end();}
    try {const body=await fs.readFile(filename);response.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});response.end(body);}
    catch {response.writeHead(404);response.end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const errors=[], failures=[], consoleErrors=[];
  try {
    const loginContext=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:900},reducedMotion:'reduce'});
    const login=await loginContext.newPage();login.on('pageerror',error=>errors.push(error.message));
    login.on('requestfailed',request=>failures.push({url:request.url(),error:request.failure()?.errorText}));
    login.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    const scriptURL = 'https://challenges.cloudflare.com/turnstile/v0/api.js*';
    await loginContext.route(scriptURL, route=>route.abort('failed'));
    await login.goto(base+'/auth/',{waitUntil:'domcontentloaded'});
    await login.locator('#turnstile-state').filter({hasText:'验证暂不可用'}).waitFor();
    assert.equal(await login.locator('#sign-in-button').isDisabled(),true);
    assert.deepEqual(requests,{challenge:0,firstfactor:0});
    await loginContext.unroute(scriptURL);
    await login.locator('#retry-turnstile').click();
    await login.locator('#turnstile-state').filter({hasText:'安全验证已通过'}).waitFor({timeout:30000});
    await login.locator('#sign-in-button:not([disabled])').waitFor({timeout:30000});
    assert.equal(await login.locator('#turnstile-section').isVisible(),true);
    assert.equal(await login.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    for (const [width,height] of [[320,740],[390,844],[768,1024],[1440,950]]) {
      await login.setViewportSize({width,height});
      await login.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await login.locator('#turnstile-state').filter({hasText:'安全验证已通过'}).waitFor({timeout:30000});
      assert.equal(await login.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await login.screenshot({path:path.join(__dirname,`turnstile-login-${width}.png`),fullPage:true});
    }
    assert.equal(await login.locator('html').getAttribute('data-skin'),'smtv');
    assert.equal(await login.locator('#p3r-auth-scene,.p3r-auth-credit').count(),0);
    await login.locator('#login-theme').click();
    assert.equal(await login.locator('html').getAttribute('data-theme'),'dark');
    await login.locator('#turnstile-state').filter({hasText:'安全验证已通过'}).waitFor({timeout:30000});
    await login.locator('#username-textfield').fill('test-admin');await login.locator('#password-textfield').fill('incorrect');
    await login.locator('#sign-in-button').click();
    await login.locator('#login-feedback').filter({hasText:'账号或密码不正确'}).waitFor();
    await login.locator('#sign-in-button:not([disabled])').waitFor({timeout:30000});
    assert.deepEqual(requests,{challenge:1,firstfactor:1});
    await loginContext.close();

    const adminContext=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:1050},reducedMotion:'reduce'});
    const admin=await adminContext.newPage();admin.on('pageerror',error=>errors.push(error.message));
    await admin.goto(base+'/admin/',{waitUntil:'domcontentloaded'});
    await admin.locator('#turnstile-preview-state').filter({hasText:'已验证'}).waitFor({timeout:30000});
    await admin.locator('#turnstile-config-state').filter({hasText:'已启用'}).waitFor();
    assert.equal(await admin.locator('#turnstile-secret-key').inputValue(),'');
    assert.equal(await admin.locator('#turnstile-secret-state').textContent(),'已配置，不会显示');
    for (const [theme,width] of [['light',390],['dark',1440]]) {
      await admin.setViewportSize({width,height:1050});await admin.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      await admin.locator('.turnstile-settings').scrollIntoViewIfNeeded();
      assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await admin.locator('.turnstile-settings').screenshot({path:path.join(__dirname,`turnstile-admin-${theme}-${width}.png`)});
    }
    await adminContext.close();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,realTurnstileScript:true,testSiteKey:true,scriptFailureRecovery:true,requests,layouts:[320,390,768,1440]}));
  } catch (error) {
    const pages=browser.contexts().flatMap(context=>context.pages());
    const diagnostic=pages[0] ? await pages[0].evaluate(()=>({title:document.title,text:document.body.innerText.slice(0,1200),feedback:document.querySelector('#login-feedback')?.textContent,state:document.querySelector('#turnstile-state')?.textContent,scripts:[...document.scripts].map(item=>item.src)})).catch(()=>({})) : {};
    error.stack += '\n' + JSON.stringify({diagnostic,errors,failures,consoleErrors});throw error;
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}

function json(response,body,headers={},status=200) {
  const data=Buffer.from(JSON.stringify(body));response.writeHead(status,{'Content-Type':'application/json','Content-Length':data.length,'Cache-Control':'no-store',...(headers||{})});response.end(data);
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
