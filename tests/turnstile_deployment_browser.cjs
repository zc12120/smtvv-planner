'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('./playwright.cjs');
const gatewayTransport = require('./gateway_transport.cjs');

const TEST_SITE_KEY = '1x00000000000000000000AA';
const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';
const privateValues = [];

async function run() {
  const base = new URL(process.env.SMTVV_URL || 'https://turnstile-test.example.com').origin;
  const upstream = process.env.SMTVV_TEST_UPSTREAM;
  assert(upstream, 'Turnstile deployment tests require an isolated gateway');
  const input = fs.readFileSync(process.env.SMTVV_CREDENTIALS_FILE || 0, 'utf8');
  const username = input.match(/^Username:\s*(\S+)$/m)?.[1];
  const password = input.match(/^Password:\s*(\S+)$/m)?.[1];
  assert(username && password, 'Isolated credentials are required');
  privateValues.push(username, password, password + '-incorrect');
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const contexts = [], transports = [], errors = [], checks = [];
  async function context(viewport={width:1440,height:1050}) {
    const value = await browser.newContext({locale:'zh-CN',viewport,reducedMotion:'reduce'});
    contexts.push(value);transports.push(await gatewayTransport(value,base,upstream));
    value.on('page', page => {page.setDefaultTimeout(30000);page.on('pageerror', error=>errors.push(error.message));});
    return value;
  }
  const call = (page, endpoint, data) => page.evaluate(async ({endpoint,data}) => {
    const response = await fetch(endpoint, data === undefined ? {cache:'no-store'} : {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',
    });
    let body;try {body=await response.json();} catch {}
    return {status:response.status,body};
  },{endpoint,data});
  async function login(page, secret) {
    await page.goto(base + '/auth/?rd=' + encodeURIComponent(base + '/admin/'), {waitUntil:'domcontentloaded'});
    await page.locator('#username-textfield').fill(username);await page.locator('#password-textfield').fill(secret);
    const [response] = await Promise.all([
      page.waitForResponse(item=>new URL(item.url()).pathname==='/auth/api/firstfactor'),
      page.locator('#sign-in-button').click(),
    ]);
    assert.equal(response.status(),200);await page.waitForURL(url=>url.pathname==='/admin/');
    await page.waitForFunction(()=>document.querySelector('#health')?.textContent==='运行正常');
  }
  try {
    const owner = await context(), admin = await owner.newPage();
    await login(admin,password);
    const initial = await call(admin,'/api/admin/overview');
    assert.equal(initial.status,200);assert.equal(initial.body.turnstile.settings.enabled,false);
    assert.equal(initial.body.turnstile.secretConfigured,false);
    await admin.locator('#turnstile-site-key').fill(TEST_SITE_KEY);
    await admin.locator('#turnstile-site-key').press('Tab');
    await admin.locator('#turnstile-secret-key').fill(TEST_SECRET_KEY);
    await admin.locator('#turnstile-enabled').check();
    await admin.locator('input[name="turnstile-appearance"][value="always"]').check();
    await admin.locator('#turnstile-preview-state').filter({hasText:'已验证'}).waitFor();
    const [saved] = await Promise.all([
      admin.waitForResponse(item=>new URL(item.url()).pathname==='/api/admin/turnstile'),
      admin.locator('#save-turnstile').click(),
    ]);
    assert.equal(saved.status(),200);const savedBody=await saved.json();
    assert.equal(savedBody.settings.enabled,true);assert.equal(savedBody.secretConfigured,true);
    assert(!JSON.stringify(savedBody).includes(TEST_SECRET_KEY));
    assert.equal(await admin.locator('#turnstile-secret-key').inputValue(),'');
    checks.push('real administrator challenge enables an atomic, non-disclosing configuration');

    const visitorContext=await context({width:390,height:900}), visitor=await visitorContext.newPage();
    await visitor.goto(base+'/auth/',{waitUntil:'domcontentloaded'});
    await visitor.locator('#turnstile-state').filter({hasText:'安全验证已通过'}).waitFor();
    const directBody={username,password,keepMeLoggedIn:false,targetURL:base+'/',requestMethod:'GET'};
    assert.equal((await call(visitor,'/auth/api/firstfactor',directBody)).status,403);
    assert.equal((await call(visitor,'/auth/api/firstfactor/',directBody)).status,403);
    checks.push('canonical and alternate first-factor paths fail closed without a ticket');

    await visitor.locator('#username-textfield').fill(username);
    await visitor.locator('#password-textfield').fill(password+'-incorrect');
    const [challenge, wrong] = await Promise.all([
      visitor.waitForResponse(item=>new URL(item.url()).pathname==='/api/login/turnstile'),
      visitor.waitForResponse(item=>new URL(item.url()).pathname==='/auth/api/firstfactor'),
      visitor.locator('#sign-in-button').click(),
    ]);
    assert.equal(challenge.status(),200);assert.equal(wrong.status(),401);
    assert.equal((await call(visitor,'/auth/api/firstfactor',directBody)).status,403);
    await visitor.locator('#turnstile-state').filter({hasText:'安全验证已通过'}).waitFor();
    checks.push('a failed password consumes its one-use, IP-bound admission ticket');

    await visitor.locator('#password-textfield').fill(password);
    const [challengeAgain, signedIn] = await Promise.all([
      visitor.waitForResponse(item=>new URL(item.url()).pathname==='/api/login/turnstile'),
      visitor.waitForResponse(item=>new URL(item.url()).pathname==='/auth/api/firstfactor'),
      visitor.locator('#sign-in-button').click(),
    ]);
    assert.equal(challengeAgain.status(),200);assert.equal(signedIn.status(),200);
    await visitor.waitForURL(url=>url.pathname==='/');
    const cookies=await visitorContext.cookies(base);
    assert(cookies.some(cookie=>cookie.name.startsWith('smtvv_session_')&&cookie.httpOnly&&cookie.secure));
    assert(!cookies.some(cookie=>cookie.name==='smtvv_turnstile'));
    checks.push('a fresh challenge permits real Authelia login and clears the admission cookie');

    const current=await call(admin,'/api/admin/overview');
    assert.equal(current.body.turnstile.settings.enabled,true);
    assert.equal(current.body.turnstile.secretConfigured,true);
    assert(!JSON.stringify(current.body).includes(TEST_SECRET_KEY));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,url:base,officialTestWidget:true,checks}));
  } finally {
    for (const transport of transports) transport.close();
    for (const value of contexts) await value.close().catch(()=>{});
    await browser.close();
  }
}

run().catch(error=>{
  let message=error.stack||String(error);
  for (const value of privateValues) if (value) message=message.split(value).join('[REDACTED]');
  console.error(message);process.exitCode=1;
});
