'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {chromium} = require('./playwright.cjs');
const gatewayTransport = require('./gateway_transport.cjs');
const privateValues = [];

async function run() {
  const base = new URL(process.env.SMTVV_URL || 'https://login-policy-test.example.com').origin;
  const upstream = process.env.SMTVV_TEST_UPSTREAM;
  assert(upstream, 'Policy mutation tests require an isolated gateway');
  const input = fs.readFileSync(process.env.SMTVV_CREDENTIALS_FILE || 0, 'utf8');
  const username = input.match(/^Username:\s*(\S+)$/m)?.[1], password = input.match(/^Password:\s*(\S+)$/m)?.[1];
  assert(username && password);privateValues.push(username,password);
  const cookieName = 'smtvv_session_' + createHash('sha256').update(base).digest('hex').slice(0,12);
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const contexts = [], transports = [], errors = [], checks = [], layouts = [];
  let admin, original, credentialStores = 0;
  const call = (page, endpoint, data) => page.evaluate(async ({endpoint,data}) => {
    const response = await fetch(endpoint, {cache:'no-store', ...(data === undefined ? {} :
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
    let body;try {body = await response.json();} catch {}
    return {status:response.status,body};
  },{endpoint,data});
  async function context() {
    const value = await browser.newContext({locale:'zh-CN',viewport:{width:1440,height:1050},reducedMotion:'reduce'});
    contexts.push(value);transports.push(await gatewayTransport(value,base,upstream));
    value.on('page', page => {page.setDefaultTimeout(25000);page.on('pageerror', error => errors.push(error.message));});
    return value;
  }
  async function login(page, keep, rememberPassword = false, forcedKeep) {
    // Start at the public portal: browser routing fixtures do not intercept
    // the second request in a server-issued redirect chain.
    await page.goto(base + '/auth/?rd=' + encodeURIComponent(base + '/admin/'), {waitUntil:'domcontentloaded'});
    await page.locator('#username-textfield').fill(username);
    await page.locator('#password-textfield').fill(password);
    const policy = (await call(page,'/api/login/options')).body.settings;
    if (policy.rememberMeEnabled) await page.locator('#remember-login').setChecked(keep);
    if (policy.rememberPasswordEnabled) await page.locator('#remember-password').setChecked(rememberPassword);
    if (forcedKeep !== undefined) {
      await page.evaluate(force => {
        const original = window.fetch;
        window.fetch = (url, options) => {
          if (url === '/auth/api/firstfactor') options = {...options,body:JSON.stringify({...JSON.parse(options.body),keepMeLoggedIn:force})};
          return original(url, options);
        };
      }, forcedKeep);
    }
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/auth/api/firstfactor'),page.locator('#sign-in-button').click()]);
    assert.equal(response.status(),200,'real Authelia login succeeds');
    const cookieBefore = (await page.context().cookies(base)).find(c => c.name === cookieName);
    assert(cookieBefore && cookieBefore.expires > Date.now()/1000, 'authenticated cookie has an absolute expiry');
    const seconds = cookieBefore.expires - Date.now()/1000;
    const expected = (policy.rememberMeEnabled && (forcedKeep ?? keep) ? policy.rememberMinutes : policy.sessionMinutes) * 60;
    assert(Math.abs(seconds - expected) <= 5, `cookie lifetime ${seconds} must match ${expected}`);
    await page.waitForURL(url => url.pathname === '/admin/');
    await page.waitForFunction(() => document.querySelector('#health')?.textContent === '运行正常');
    const cookie = (await page.context().cookies(base)).find(c => c.name === cookieName);
    assert(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.expires > Date.now()/1000);
    privateValues.push(cookie.value);
    return seconds;
  }
  async function savePolicy(page, patch) {
    const current = (await call(page,'/api/admin/login-policy')).body;
    const result = await call(page,'/api/admin/login-policy',{revision:current.revision,patch});
    assert.equal(result.status,200);
    if (result.body.sessionChanged) assert.equal(result.body.sessionsRevoked,true,'supervisor must apply the policy and revoke old sessions');
    return result.body;
  }
  try {
    const owner = await context();
    await owner.exposeBinding('__credentialStored', (_source, value) => {
      assert.equal(value.id,username);assert.equal(value.password,password);credentialStores++;
    });
    await owner.addInitScript(() => {
      // Only the browser password-manager API is a fixture. All login and
      // session checks go through the real gateway and authentication service.
      window.PasswordCredential = class {constructor(value) {Object.assign(this,value,{type:'password'});}};
      Object.defineProperty(navigator,'credentials',{value:{get:async()=>null,
        store:async value=>{await window.__credentialStored(value);return value;},preventSilentAccess:async()=>{}}});
    });
    admin = await owner.newPage();
    const normal = await login(admin,false,true);
    original = (await call(admin,'/api/admin/login-policy')).body.settings;
    assert.equal(credentialStores,1,'remember password delegates to the browser credential manager');
    const stored = await admin.evaluate(() => JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
    assert(!stored.includes(password),'password never enters web storage');
    const preferences = JSON.parse(await admin.evaluate(() => localStorage.getItem('smtvv-login-preferences-v1')));
    assert.deepEqual(Object.keys(preferences).sort(),['keepLoggedIn','rememberPassword','username']);
    checks.push({name:'normal login, real cookie flags and browser password saving',seconds:normal});

    const visitorContext = await context(), visitor = await visitorContext.newPage();
    await visitor.goto(base+'/auth/');
    assert.equal((await call(visitor,'/api/admin/login-policy')).status,401);
    assert.equal((await call(visitor,'/api/login/options')).status,200);
    for (const width of [320,390,768,1024,1440]) {
      await visitor.setViewportSize({width,height:950});
      await visitor.evaluate(() => document.fonts.ready);
      assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      const box = await visitor.locator('#password-textfield').boundingBox();
      assert(box.x >= 0 && box.x+box.width <= width+1 && box.height >= 44);
      layouts.push({page:'login',width,ok:true});
      if (width===390 || width===1440) await visitor.screenshot({path:path.join(__dirname,`login-policy-login-${width}.png`),fullPage:true});
    }
    for (const theme of ['light','dark']) for (const width of [320,390,768,1024,1440]) {
      await admin.setViewportSize({width,height:1050});
      await admin.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
      await admin.locator('#login-policy').scrollIntoViewIfNeeded();
      assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      layouts.push({page:'admin',theme,width,ok:true});
      if (width===390 || width===1440) await admin.locator('#login-policy').screenshot({path:path.join(__dirname,`login-policy-admin-${theme}-${width}.png`)});
    }
    checks.push({name:'login and admin responsive layouts, both admin themes'});

    await admin.locator('#remember-default').check();
    const [savedPreference] = await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/login-policy'),admin.locator('#save-login-policy').click()]);
    assert.equal((await savedPreference.json()).sessionChanged,false);
    assert.equal((await call(admin,'/api/admin/overview')).status,200);
    await visitor.reload();await visitor.locator('#remember-login').waitFor();
    assert.equal(await visitor.locator('#remember-login').isChecked(),true);
    checks.push({name:'default remember option applies to new browsers without logging the administrator out'});

    await admin.locator('#session-hours').fill('36');
    await savePolicy(admin,{rememberPasswordEnabled:false});
    await admin.locator('#refresh').click();
    await admin.waitForFunction(()=>document.querySelector('#login-policy-state').textContent.includes('其他页面'));
    assert.equal(await admin.locator('#session-hours').inputValue(),'36');
    const [conflict] = await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/login-policy'),admin.locator('#save-login-policy').click()]);
    assert.equal(conflict.status(),409);
    assert.equal(await admin.locator('#session-hours').inputValue(),'36');
    await admin.locator('#discard-login-policy').click();
    await visitor.reload();await visitor.locator('#login-fields:not([disabled])').waitFor();
    assert.equal(await visitor.locator('#remember-password-option').isVisible(),false);
    checks.push({name:'password-saving switch, preserved drafts and conflicting edits'});

    await admin.locator('#session-hours').fill('48');
    await admin.locator('#inactivity-minutes').fill('120');
    await admin.locator('#remember-days').fill('14');
    await admin.locator('#remember-password-enabled').check();
    const staleCookies = await owner.cookies(base);
    const [savedSession] = await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/login-policy'),admin.locator('#save-login-policy').click()]);
    assert.equal((await savedSession.json()).sessionsRevoked,true);
    assert.equal((await call(admin,'/api/admin/overview')).status,401);
    const replayContext = await context();await replayContext.addCookies(staleCookies);
    const replay = await replayContext.newPage();await replay.goto(base+'/auth/');
    assert.equal((await call(replay,'/api/admin/overview')).status,401);
    const remembered = await login(admin,true);
    assert(Math.abs(remembered-14*86400)<=5);
    const another = await owner.newPage();await another.goto(base+'/admin/');
    await another.waitForFunction(()=>document.querySelector('#health')?.textContent==='运行正常');
    await another.close();
    checks.push({name:'changed normal/remembered lifetimes apply, previous cookies revoked, new tabs retain login',rememberedSeconds:remembered});

    await savePolicy(admin,{rememberMeEnabled:false,rememberPasswordEnabled:false});
    const disabled = await login(admin,false,false,true);
    assert(Math.abs(disabled-48*3600)<=5,'a stale client requesting remember-me receives the normal lifetime');
    await savePolicy(admin,{sessionMinutes:5,inactivityMinutes:1,rememberMinutes:10080,rememberMeEnabled:true,rememberPasswordEnabled:true,rememberMeDefault:false});
    await login(admin,false);await admin.goto(base+'/auth/');
    await admin.locator('#logout-button').waitFor();
    const longContext = await context(), longPage = await longContext.newPage();
    await login(longPage,true);await longPage.goto(base+'/auth/');await longPage.locator('#logout-button').waitFor();
    console.log('Checking a real one-minute inactivity boundary for ordinary and remembered sessions.');
    await new Promise(resolve=>setTimeout(resolve,65000));
    assert.equal((await call(admin,'/api/admin/overview')).status,401,'ordinary login expires after configured inactivity');
    assert.equal((await call(longPage,'/api/admin/overview')).status,200,'remembered login survives ordinary inactivity timeout');
    checks.push({name:'real idle expiry and remembered-session exemption',waitedSeconds:65});

    const oldCookies = await longContext.cookies(base);
    await longPage.locator('#logout-button').click();
    await longPage.locator('#username-textfield').waitFor();
    assert.equal((await call(longPage,'/api/admin/overview')).status,401);
    const logoutReplay = await context();await logoutReplay.addCookies(oldCookies);
    const replayPage = await logoutReplay.newPage();await replayPage.goto(base+'/auth/');
    assert.equal((await call(replayPage,'/api/admin/overview')).status,401);
    checks.push({name:'explicit logout revokes remembered cookies and prevents replay'});

    await login(admin,true);
    await savePolicy(admin,original);
    assert.deepEqual((await call(visitor,'/api/login/options')).body.settings,original);
    assert.deepEqual(errors,[]);
    const report={ok:true,base,isolated:true,transport:'real HTTP gateway forwarding',credentialManagerFixture:true,checks,layouts};
    fs.writeFileSync(path.join(__dirname,'login-policy-validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } catch (error) {
    if (admin) {
      await admin.screenshot({path:path.join(__dirname,'login-policy-failure.png'),fullPage:true}).catch(()=>{});
      const diagnostic = await admin.evaluate(()=>({path:location.pathname,feedback:document.querySelector('#feedback')?.textContent,login:document.querySelector('#login-feedback')?.textContent})).catch(()=>({}));
      error.message += '\n'+JSON.stringify({checks,diagnostic,errors});
    }
    throw error;
  } finally {
    await browser.close();for (const transport of transports) transport.close();
  }
}
run().catch(error=>{
  let message=error.stack || error.message;
  for (const value of privateValues) if (value) message=message.split(value).join('[REDACTED]');
  console.error(message);process.exitCode=1;
});
