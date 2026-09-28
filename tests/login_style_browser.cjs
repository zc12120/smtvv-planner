'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('./playwright.cjs');
const root=path.join(__dirname,'../web');const out=path.join(__dirname,'../outputs/login-style-20260917');
const policy={sessionMinutes:1440,inactivityMinutes:720,rememberMinutes:43200,rememberMeEnabled:true,rememberMeDefault:false,rememberPasswordEnabled:true};
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const server=http.createServer(async(req,res)=>{
  let file=new URL(req.url,'http://127.0.0.1').pathname;if(file==='/auth/')file='/auth/index.html';
  const name=path.resolve(root,'.'+decodeURIComponent(file));if(!name.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  try{const body=await fs.readFile(name);res.writeHead(200,{'Content-Type':({'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.woff2':'font/woff2'})[path.extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({args:['--no-sandbox','--no-proxy-server']});let page;
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[],checks=[],layouts=[];let optionsStatus=200,authenticated=false,turnstile=false,signIn=0,verification=0,lastLogin;
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/api/login/options',route=>route.fulfill({status:optionsStatus,json:optionsStatus===200?{settings:policy,turnstile:turnstile?{enabled:true,siteKey:'test-site-key',theme:'auto',appearance:'always'}:{enabled:false}}:{error:'登录服务暂时不可用，请稍后重试。'}}));
  await context.route('**/auth/api/state',route=>route.fulfill({json:{data:{authentication_level:authenticated?1:0,username:'test-account'}}}));
  await context.route('**/api/login/turnstile',route=>{verification++;return route.fulfill({json:{verified:true}});});
  await context.route('**/auth/api/firstfactor',route=>{signIn++;lastLogin=route.request().postDataJSON();authenticated=lastLogin.password==='fixture-correct-password';return route.fulfill({status:authenticated?200:401,json:authenticated?{data:{}}:{error:'账号或密码不正确，请重新输入。'}});});
  await context.route('**/auth/api/logout',route=>{authenticated=false;return route.fulfill({json:{data:{}}});});
  await context.route(base+'/',route=>route.fulfill({contentType:'text/html',body:'<title>Fixture destination</title>'}));
  await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js*',route=>route.fulfill({contentType:'text/javascript',body:"window.widgetCalls=[];window.turnstile={render(selector,options){widgetCalls.push(options);return String(widgetCalls.length);},remove(){},reset(){}};"}));
  const ready=async p=>{await p.locator('#login-fields:not([disabled])').waitFor();await p.locator('#site-language').waitFor();await p.evaluate(()=>document.fonts.ready);};
  page=await context.newPage();await page.goto(base+'/auth/');await ready(page);
  assert.equal(await page.locator('#p3r-auth-scene,.p3r-auth-credit').count(),0);assert.equal(await page.locator('.login-brand img').evaluate(e=>e.complete&&e.naturalWidth>0),true);
  await page.locator('#username-textfield').fill('test-account');await page.locator('#password-textfield').fill('fixture-wrong-password');await page.locator('#show-login-password').click();assert.equal(await page.locator('#password-textfield').getAttribute('type'),'text');await page.locator('#show-login-password').click();
  await page.locator('#sign-in-button').click();await page.locator('#login-feedback:not([hidden])').waitFor();assert.equal(signIn,1);assert.match(await page.locator('#login-feedback').innerText(),/密码不正确/);
  assert.equal(await page.locator('#password-textfield').inputValue(),'fixture-wrong-password');await page.locator('#password-textfield').fill('fixture-correct-password');await page.locator('#remember-login').check();await page.locator('#remember-password').check();await page.locator('#sign-in-button').click();await page.waitForURL(base+'/');assert.equal(lastLogin.keepMeLoggedIn,true);assert.equal(lastLogin.targetURL,base+'/');
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));assert(!stored.includes('fixture-correct-password'));assert(stored.includes('test-account'));
  await page.goto(base+'/auth/');await page.locator('#authenticated-view:not([hidden])').waitFor();assert.equal(await page.locator('#authenticated-username').innerText(),'test-account');await page.locator('#logout-button').click();await ready(page);assert.equal(await page.locator('#password-textfield').inputValue(),'');checks.push('password visibility, wrong-password feedback, remembered choices, same-origin return and logout work without storing passwords');

  optionsStatus=503;await page.reload();await page.locator('#retry-login:not([hidden])').waitFor();assert(await page.locator('#sign-in-button').isDisabled());optionsStatus=200;await page.locator('#retry-login').click();await ready(page);checks.push('login settings failure presents a working reconnect action');
  turnstile=true;await page.reload();await ready(page);await page.waitForFunction(()=>window.widgetCalls?.length===1);assert(await page.locator('#sign-in-button').isDisabled());assert.equal(await page.evaluate(()=>widgetCalls[0].theme),'light');
  await page.locator('#login-theme').click();await page.waitForFunction(()=>widgetCalls.at(-1).theme==='dark');await page.evaluate(()=>widgetCalls[0].callback('stale'));assert(await page.locator('#sign-in-button').isDisabled());
  await page.evaluate(()=>widgetCalls.at(-1)['error-callback']());await page.locator('#retry-turnstile').click();await page.waitForFunction(()=>widgetCalls.length>=3);await page.evaluate(()=>widgetCalls.at(-1).callback('valid-fixture-token'));assert(await page.locator('#sign-in-button').isEnabled());
  await page.locator('#username-textfield').fill('test-account');await page.locator('#password-textfield').fill('fixture-wrong-password');await page.locator('#sign-in-button').click();await page.locator('#login-feedback:not([hidden])').waitFor();assert.equal(verification,1);assert.equal(signIn,3);assert(await page.locator('#sign-in-button').isDisabled());checks.push('verification follows the selected theme, rejects old callbacks, retries failure and precedes login');turnstile=false;

  for(const language of ['zh-Hans','en','ja','zh-Hant','ko']){
   await page.goto(base+'/auth/?lang='+language);await ready(page);
   for(const theme of ['light','dark'])for(const font of ['standard','large'])for(const width of [320,390,768,1440]){
    await page.evaluate(({theme,font})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.font=font;},{theme,font});await page.setViewportSize({width,height:900});
    const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,clipped:[...document.querySelectorAll('button,h1,.login-panel,.login-header')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className),passwordToggle:document.querySelector('#show-login-password').getBoundingClientRect().width,passwordPadding:parseFloat(getComputedStyle(document.querySelector('#password-textfield')).paddingRight)}));
    assert.equal(metrics.overflow,false,JSON.stringify({language,theme,font,width,...metrics}));assert.deepEqual(metrics.clipped,[],JSON.stringify({language,theme,font,width,...metrics}));assert(metrics.passwordPadding>=metrics.passwordToggle,'password text clears the visibility button');layouts.push({language,theme,font,width});
   }
   if(language==='en'||language==='ko')assert.equal(await page.evaluate(()=>/[\u3400-\u9fff]/.test(document.body.innerText)),false);
  }
  checks.push('five languages, two themes, two font sizes and four widths fit in 80 layouts');
  await page.goto(base+'/auth/?lang=zh-Hans');await ready(page);await page.locator('#login-theme').click();await page.locator('#login-font').click();const prefs=await page.locator('html').evaluate(e=>({...e.dataset}));await page.reload();await ready(page);assert.equal(await page.locator('html').getAttribute('data-theme'),prefs.theme);assert.equal(await page.locator('html').getAttribute('data-font'),prefs.font);
  for(const [name,width,theme]of [['desktop',1440,'light'],['dark',1440,'dark'],['mobile',390,'light']]){await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.font='standard';},theme);await page.screenshot({path:path.join(out,name+'.png')});}
  await page.locator('#site-language').click();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.language),'ko');await page.keyboard.press('Escape');assert.equal(await page.locator('#site-language').getAttribute('aria-expanded'),'false');
  authenticated=true;await page.reload();await page.locator('#authenticated-view:not([hidden])').waitFor();await page.screenshot({path:path.join(out,'account-mobile.png')});
  assert.deepEqual(errors,[]);const record={ok:true,checks,layouts:layouts.length,productionCredentialsUsed:false};await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
