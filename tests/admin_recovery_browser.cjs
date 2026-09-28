'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('./playwright.cjs');
const secrets = [];
const engine = process.env.SMTVV_TEST_BROWSER || 'chromium';
assert(['chromium', 'firefox', 'webkit'].includes(engine));
const artifact = suffix => path.join(__dirname, 'admin-recovery' + (engine === 'chromium' ? '' : '-' + engine) + suffix);

async function run() {
  const base = new URL(process.env.SMTVV_URL || 'https://planner.example.com').origin;
  assert(base.startsWith('https://'), 'Administrator recovery requires HTTPS');
  const credentials = await fs.readFile(process.env.SMTVV_CREDENTIALS_FILE ||
    path.join(__dirname, '../runtime/credentials.txt'), 'utf8');
  const username = credentials.match(/^Username:\s*(\S+)$/m)?.[1];
  const password = credentials.match(/^Password:\s*(\S+)$/m)?.[1];
  assert(username && password, 'A private credentials file is required');
  secrets.push(password);
  const checks = [], errors = [];
  let browser, proxy, admin;
  try {
    const args = ['--no-sandbox'];
    if (process.env.SMTVV_TEST_UPSTREAM) {
      assert.equal(engine, 'chromium', 'The isolated DNS fixture requires Chromium');
      proxy = await require('./tls_proxy.cjs')(new URL(base).hostname, process.env.SMTVV_TEST_UPSTREAM);
      args.push('--no-proxy-server', '--host-resolver-rules=MAP ' + new URL(base).hostname + ' 127.0.0.1:' + proxy.port);
    }
    const browserType = engine === 'chromium' ? chromium : require('playwright')[engine];
    browser = await browserType.launch({headless: true, ...(engine === 'chromium' ? {args} : {})});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000},
      locale: 'zh-CN', reducedMotion: 'reduce', ignoreHTTPSErrors: !!proxy});
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    admin = await context.newPage();
    admin.setDefaultTimeout(20000);
    const ready = page => page.waitForFunction(() => document.querySelector('#health')?.textContent === '运行正常');
    async function login(page, url = base + '/admin/') {
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      if (new URL(page.url()).pathname.startsWith('/auth/')) {
        await page.locator('input[autocomplete="username"], #username-textfield').first().fill(username);
        await page.locator('input[type="password"]').first().fill(password);
        // Authelia loads translations asynchronously; let its portal settle
        // before navigating away so this test isolates administrator requests.
        await page.waitForLoadState('networkidle');
        const [response] = await Promise.all([
          page.waitForResponse(r => new URL(r.url()).pathname === '/auth/api/firstfactor'),
          page.getByRole('button', {name: /Sign in|登录|登入/i}).first().click(),
        ]);
        assert.equal(response.status(), 200);
        await page.waitForURL(url => url.pathname.startsWith('/admin/'));
      }
      await ready(page);
    }
    const exported = page => page.evaluate(() => fetch('/api/admin/export').then(r => r.json()));
    await login(admin);
    const original = await exported(admin);
    const draft = {title: '会话恢复检查（未发布）', body: '这份公告草稿应在重新登录后继续保留。\n不会发布到网站。'};
    await admin.locator('#notice-title').fill(draft.title);
    await admin.locator('#notice-body').fill(draft.body);
    assert.equal(await admin.evaluate(() => fetch('/auth/api/logout', {method: 'POST'}).then(r => r.status)), 200);
    await admin.locator('#refresh').click();
    await admin.locator('#session-error').waitFor({state: 'visible'});
    assert.equal(await admin.locator('#notice-body').isDisabled(), true);
    const returnLink = await admin.locator('#session-error a').getAttribute('href');
    const portal = await context.newPage();
    await login(portal, new URL(returnLink, base).href);
    await admin.bringToFront();
    await admin.locator('#refresh').click();
    await admin.waitForFunction(() => document.querySelector('#session-error').hidden &&
      !document.querySelector('#notice-form fieldset').disabled, {}, {timeout: 10000});
    assert.equal(await admin.locator('#notice-title').inputValue(), draft.title);
    assert.equal(await admin.locator('#notice-body').inputValue(), draft.body);
    assert.match(await admin.locator('#notice-state').textContent(), /未保存/);
    assert.equal(await admin.locator('#session-error a').getAttribute('target'), '_blank');
    assert.match(await admin.locator('#session-error a').getAttribute('rel'), /noopener/);
    assert.deepEqual(await exported(admin), original, 'draft recovery must not publish settings');
    checks.push('real logout and re-login unlock the original tab and preserve its unpublished draft');
    await portal.close();
    await admin.locator('#discard-notice').click();

    // Drop real script requests only in this browser to exercise the recovery UI.
    let requests = 0;
    await admin.route('**/admin/admin.js*', route => ++requests === 1 ? route.abort('connectionreset') : route.continue());
    await admin.reload({waitUntil: 'domcontentloaded'});
    await ready(admin);
    assert.equal(requests, 2, 'one failed script request should recover automatically');
    await admin.unroute('**/admin/admin.js*');
    checks.push('a transient administrator script failure recovers automatically');

    requests = 0;
    await admin.route('**/admin/admin.js*', route => { requests++; return route.abort('connectionreset'); });
    await admin.reload({waitUntil: 'domcontentloaded'});
    await admin.waitForFunction(() => document.querySelector('#refresh')?.textContent.includes('重新加载'));
    assert.equal(requests, 3, 'a persistent failure has bounded retries');
    assert.match(await admin.locator('#feedback').textContent(), /页面资源/);
    await admin.unroute('**/admin/admin.js*');
    await admin.locator('#refresh').click();
    await ready(admin);
    checks.push('a persistent script failure offers a working reload action');

    await admin.locator('#notice-body').fill(draft.body);
    await admin.route('**/api/admin/overview', route => route.fulfill({status: 503,
      contentType: 'application/json', body: '{"error":"临时连接故障"}'}));
    await admin.locator('#refresh').click();
    await admin.waitForFunction(() => document.querySelector('#health').textContent === '连接异常');
    assert.equal(await admin.locator('#notice-body').inputValue(), draft.body);
    await admin.unroute('**/api/admin/overview');
    await admin.locator('#refresh').click();
    await ready(admin);
    assert.equal(await admin.locator('#notice-body').inputValue(), draft.body);
    assert.deepEqual(await exported(admin), original);
    await admin.locator('#discard-notice').click();
    checks.push('a failed status request can recover without losing or publishing a draft');
    let release, entered;
    const responseGate = new Promise(resolve => { release = resolve; });
    const requestStarted = new Promise(resolve => { entered = resolve; });
    await admin.route('**/api/admin/overview', async route => {
      entered();
      await responseGate;
      await route.continue().catch(() => {}); // The old document may already be gone.
    });
    await admin.locator('#refresh').click();
    await requestStarted;
    try { await admin.goto(base + '/auth/', {waitUntil: 'domcontentloaded'}); }
    finally { release(); await admin.unroute('**/api/admin/overview'); }
    await admin.getByRole('button', {name: /Logout|Log out|Sign out|退出|登出|注销/i}).first().waitFor();
    await admin.waitForLoadState('networkidle');
    await admin.goto(base + '/admin/', {waitUntil: 'domcontentloaded'});
    await ready(admin);
    checks.push('leaving with a pending status request and returning keeps the administrator usable');
    assert.deepEqual(errors, []);
    await admin.screenshot({path: artifact('.png')});
    await admin.evaluate(() => fetch('/auth/api/logout', {method: 'POST'}));
    const report = {ok: true, engine, url: base, isolatedGateway: !!proxy, checks};
    await fs.writeFile(artifact('-validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } catch (error) {
    if (admin) await admin.screenshot({path: artifact('-failure.png')}).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (proxy) await proxy.close();
  }
}

run().catch(error => {
  let message = error.stack || String(error);
  for (const secret of secrets) if (secret) message = message.split(secret).join('[REDACTED]');
  console.error(message); process.exitCode = 1;
});
