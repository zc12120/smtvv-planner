'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {chromium} = require('./playwright.cjs');
const privateValues = [];

async function run() {
  const base = new URL(process.env.SMTVV_URL || 'https://planner.example.com').origin;
  const mutations = process.env.SMTVV_ADMIN_MUTATIONS === '1';
  const prefix = process.env.SMTVV_ARTIFACT_PREFIX || 'admin';
  assert(/^[a-z0-9-]+$/.test(prefix),'Artifact prefix must be a simple filename');
  const artifact = suffix => path.join(__dirname,prefix+'-'+suffix);
  if (mutations && !process.env.SMTVV_TEST_UPSTREAM) throw Error('Mutation tests require an isolated loopback gateway');
  const credentials = await fs.readFile(process.env.SMTVV_CREDENTIALS_FILE || path.join(__dirname,'../runtime/credentials.txt'),'utf8');
  const username = credentials.match(/^Username:\s*(\S+)$/m)?.[1];
  const password = credentials.match(/^Password:\s*(\S+)$/m)?.[1];
  assert(username && password,'Private credentials file is required');
  privateValues.push(password);
  const checks = [], errors = [];
  let browser, proxy, admin, originalSettings;
  try {
    const args = ['--no-sandbox'];
    if (process.env.SMTVV_TEST_UPSTREAM) {
      proxy = await require('./tls_proxy.cjs')(new URL(base).hostname,process.env.SMTVV_TEST_UPSTREAM);
      args.push('--no-proxy-server','--host-resolver-rules=MAP '+new URL(base).hostname+' 127.0.0.1:'+proxy.port);
    }
    browser = await chromium.launch({headless:true,args});
    const options = {viewport:{width:1440,height:1050},locale:'zh-CN',reducedMotion:'reduce',ignoreHTTPSErrors:!!proxy};
    const context = await browser.newContext(options);
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    admin = await context.newPage();admin.setDefaultTimeout(20000);
    async function login(page, secret) {
      await page.goto(base+'/admin/',{waitUntil:'domcontentloaded'});
      if (new URL(page.url()).pathname.startsWith('/auth/')) {
        await page.locator('input[autocomplete="username"], input[name="username"], #username-textfield').first().fill(username);
        await page.locator('input[type="password"]').first().fill(secret);
        const [response] = await Promise.all([
          page.waitForResponse(r => new URL(r.url()).pathname === '/auth/api/firstfactor'),
          page.getByRole('button',{name:/Sign in|登录|登入/i}).first().click(),
        ]);
        assert.equal(response.status(),200,'login succeeds');
        await page.waitForURL(url => url.pathname.startsWith('/admin'));
      }
      await page.waitForFunction(() => document.querySelector('#health')?.textContent === '运行正常');
    }
    const call = (page, endpoint, data) => page.evaluate(async ({endpoint,data}) => {
      const response = await fetch(endpoint, data === undefined ? {cache:'no-store'} : {
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',
      });
      let body;try {body=await response.json();} catch {}
      return {status:response.status,body,cache:response.headers.get('cf-cache-status'),control:response.headers.get('cache-control')};
    },{endpoint,data});
    await login(admin,password);
    const overview = await call(admin,'/api/admin/overview');
    assert.equal(overview.status,200);assert.equal(overview.body.account.username,username);
    assert.equal(overview.body.account.canChangePassword,true);
    assert.notEqual(overview.cache,'HIT');assert.match(overview.control || '',/no-store/);
    originalSettings = overview.body.settings;
    checks.push('real administrator login and private overview');
    const anonymous = await browser.newContext(options);
    const visitor = await anonymous.newPage();visitor.setDefaultTimeout(20000);
    await visitor.goto(base+'/auth/');
    assert.equal((await call(visitor,'/api/admin/overview')).status,401);
    assert.equal(await visitor.evaluate(() => fetch('/api/admin/overview',{headers:{'Remote-User':'forged','Remote-Groups':'admins'}}).then(r=>r.status)),401);
    assert.equal(await visitor.evaluate(() => fetch('/_internal/admin-access').then(r=>r.status)),404);
    checks.push('anonymous and forged administrator identities are denied');
    const exported = await call(admin,'/api/admin/export');
    assert.equal(exported.status,200);assert.deepEqual(exported.body.settings,originalSettings);
    assert.deepEqual(Object.keys(exported.body).sort(),['schema','settings']);
    checks.push('settings export contains no accounts or secrets');

    if (mutations) {
      await admin.locator('#require-login').uncheck();
      await admin.waitForFunction(() => document.querySelector('#feedback').textContent.includes('网站已开放'));
      await visitor.goto(base+'/#config='+encodeURIComponent(JSON.stringify({target:'Angel',skills:['Dia']})));
      await visitor.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
      assert.equal((await call(visitor,'/api/catalog')).status,200);
      assert.equal((await call(visitor,'/api/admin/overview')).status,401);
      assert.equal(await visitor.getByRole('link',{name:'管理后台',exact:true}).count(),0);
      checks.push('public tool works while administrator routes remain protected');

      await admin.locator('#maintenance').check();
      await admin.waitForFunction(() => document.querySelector('#feedback').textContent.includes('维护模式已开启'));
      await visitor.bringToFront();
      await visitor.waitForFunction(() => document.querySelector('#calculate').disabled && document.querySelector('.site-operation--maintenance'));
      assert.equal((await call(visitor,'/api/optimal/start',{target:'Angel',skills:['Dia']})).status,503);
      await admin.locator('#maintenance').uncheck();
      await admin.waitForFunction(() => document.querySelector('#feedback').textContent.includes('维护模式已关闭'));
      await visitor.bringToFront();
      await visitor.waitForFunction(() => !document.querySelector('#calculate').disabled && !document.querySelector('.site-operation--maintenance'));
      checks.push('maintenance starts and ends on an already-open page without reloading');

      await admin.locator('#notice-enabled').check();
      await admin.locator('#notice-title').fill('测试公告 / 更新同步');
      const noticeBody = '<img src=x onerror="window.noticeExecuted=1">\n第二行公告';
      await admin.locator('#notice-body').fill(noticeBody);
      await admin.locator('#save-notice').click();
      await admin.waitForFunction(() => document.querySelector('#feedback').textContent.includes('公告设置已保存'));
      await visitor.bringToFront();
      await visitor.waitForFunction(() => document.querySelector('.site-operation--notice p')?.textContent.includes('第二行公告'));
      assert.equal(await visitor.locator('.site-operation--notice p').textContent(),noticeBody);
      assert.equal(await visitor.locator('.site-operation--notice img').count(),0);
      assert.equal(await visitor.evaluate(() => window.noticeExecuted),undefined);
      checks.push('announcements refresh automatically and display HTML as plain text');

      await admin.locator('#notice-body').fill('尚未保存的草稿');
      const before = await call(admin,'/api/admin/settings');
      assert.equal((await call(admin,'/api/admin/settings',{revision:before.body.revision,patch:{notice:{enabled:true,title:'另一页面更新',body:'已经发布的内容'}}})).status,200);
      await admin.locator('#refresh').click();
      await admin.waitForFunction(() => document.querySelector('#notice-state').textContent.includes('其他页面'));
      await admin.locator('#save-notice').click();
      await admin.waitForFunction(() => document.querySelector('#feedback').textContent.includes('其他页面'));
      assert.equal(await admin.locator('#notice-body').inputValue(),'尚未保存的草稿');
      await admin.locator('#discard-notice').click();
      assert.equal(await admin.locator('#notice-body').inputValue(),'已经发布的内容');
      checks.push('concurrent announcement edits cannot silently overwrite each other');

      await visitor.locator('#calculate').click();
      await visitor.waitForFunction(() => window.currentPage?.finished,{}, {timeout:45000});
      assert.equal(await visitor.evaluate(() => currentPage.complete),true);
      assert.equal(await visitor.locator('.strategy').count(),3);
      await admin.locator('#refresh').click();
      await admin.waitForFunction(() => document.querySelectorAll('#job-list tr small').length > 0);
      checks.push('anonymous calculation produces three routes and appears in the administrator task list');
      const work = {target:'Arioch',skills:['Figment Slash','Phys Pleroma','High Phys Pleroma']};
      for (let i=0;i<3;i++) assert.equal((await call(visitor,'/api/optimal/start',{...work,requestId:'admin-browser-'+crypto.randomUUID()})).status,200);
      await admin.locator('#refresh').click();
      await admin.locator('[data-cancel]').first().waitFor();
      const [cancelled] = await Promise.all([
        admin.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/jobs/cancel'),
        admin.locator('[data-cancel]').first().click(),
      ]);
      assert.equal(cancelled.status(),200);
      assert.equal((await cancelled.json()).cancelled,true);
      let pending = await call(admin,'/api/admin/jobs');
      for (const item of pending.body.items.filter(item=>item.canCancel)) await call(admin,'/api/admin/jobs/cancel',{jobId:item.id});
      checks.push('administrator can cancel a running or queued real calculation');
      const current = await call(admin,'/api/admin/settings');
      assert.equal((await call(admin,'/api/admin/settings',{revision:current.body.revision,patch:originalSettings})).status,200);

      async function changePassword(currentPassword,newPassword) {
        await admin.locator('#current-password').fill(currentPassword);
        await admin.locator('#new-password').fill(newPassword);
        await admin.locator('#confirm-password').fill(newPassword);
        const [response] = await Promise.all([
          admin.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/password',{timeout:30000}),
          admin.locator('#save-password').click(),
        ]);
        assert.equal(response.status(),200);
        const body = await response.json();
        assert.equal(body.changed,true);assert.equal(body.sessionsRevoked,true);
      }
      const previousCookies = await context.cookies(base);
      previousCookies.forEach(cookie => privateValues.push(cookie.value));
      const nextPassword = 'Test-'+crypto.randomBytes(24).toString('base64url');privateValues.push(nextPassword);
      await changePassword(password,nextPassword);
      const replay = await browser.newContext(options);await replay.addCookies(previousCookies);
      const replayPage = await replay.newPage();await replayPage.goto(base+'/auth/');
      assert.equal((await call(replayPage,'/api/admin/overview')).status,401);await replay.close();
      await login(admin,nextPassword);
      await changePassword(nextPassword,password);
      await login(admin,password);
      checks.push('real password changes revoke old sessions; new login succeeds; original test password restored');
    }
    for (const width of [320,390,768,1024,1440]) {
      await admin.setViewportSize({width,height:1050});
      await admin.evaluate(() => document.fonts.ready);
      assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'layout width '+width);
    }
    await admin.setViewportSize({width:1440,height:1050});
    await admin.evaluate(() => scrollTo(0,0));
    await admin.screenshot({path:artifact('desktop.png')});
    await admin.locator('#theme').click();
    await admin.screenshot({path:artifact('dark.png')});
    await admin.setViewportSize({width:390,height:844});
    await admin.screenshot({path:artifact('mobile.png')});
    assert.deepEqual(errors,[]);
    checks.push('SMT V layout at five widths, both themes, with no JavaScript errors');
    const report = {ok:true,url:base,mutations,isolatedGateway:!!proxy,checks};
    await fs.writeFile(artifact('validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } catch (error) {
    if (admin) await admin.screenshot({path:artifact('failure.png')}).catch(()=>{});
    error.stack += '\nCompleted checks: '+JSON.stringify(checks)+'\nPage errors: '+JSON.stringify(errors);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (proxy) await proxy.close();
  }
}

run().catch(error => {
  let message = error.stack || String(error);
  for (const value of privateValues) if (value) message = message.split(value).join('[REDACTED]');
  console.error(message);process.exitCode=1;
});
