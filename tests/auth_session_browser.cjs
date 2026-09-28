'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('./playwright.cjs');
const secrets = [];

async function run() {
  const base = new URL(process.env.SMTVV_URL || 'https://planner.example.com').origin;
  assert(base.startsWith('https://'), 'Session tests require HTTPS');
  const hostname = new URL(base).hostname;
  const cookieName = process.env.SMTVV_SESSION_COOKIE ||
    'smtvv_session_' + createHash('sha256').update(base).digest('hex').slice(0, 12);
  const credentials = await fs.readFile(process.env.SMTVV_CREDENTIALS_FILE ||
    path.join(__dirname, '../runtime/credentials.txt'), 'utf8');
  const username = credentials.match(/^Username:\s*(\S+)$/m)?.[1];
  const password = credentials.match(/^Password:\s*(\S+)$/m)?.[1];
  if (!username || !password) throw Error('Private credentials file is incomplete');
  secrets.push(password);
  const stale = (name, domain, cookiePath) => ({name, domain, path: cookiePath,
    value: 'stale-session-fixture', secure: true, httpOnly: true, sameSite: 'Lax'});
  const legacy = [stale('smtvv_session', hostname, '/')];
  for (const cookiePath of ['/', '/auth/', '/api/', '/admin/']) {
    legacy.push(stale('smtvv_session', '.' + hostname, cookiePath));
  }
  // With three or more labels, also reproduce a cookie inherited from a parent.
  if (hostname.split('.').length >= 3) {
    legacy.push(stale('smtvv_session', '.' + hostname.split('.').slice(1).join('.'), '/'));
  }
  const scenarios = [
    {name: 'fresh browser', cookies: []},
    {name: 'expired current cookie', cookies: [stale(cookieName, '.' + hostname, '/')]},
    {name: 'legacy host, parent and path cookies', cookies: legacy},
  ];
  const checks = [];
  let browser, proxy;
  try {
    const args = ['--no-sandbox'];
    if (process.env.SMTVV_TEST_UPSTREAM) {
      proxy = await require('./tls_proxy.cjs')(hostname, process.env.SMTVV_TEST_UPSTREAM);
      args.push('--no-proxy-server', '--host-resolver-rules=MAP ' + hostname + ' 127.0.0.1:' + proxy.port);
    }
    browser = await chromium.launch({headless: true, args});
    const options = {locale: 'zh-CN', viewport: {width: 1440, height: 1000},
      reducedMotion: 'reduce', ignoreHTTPSErrors: !!proxy};

    async function login(page) {
      await page.locator('input[autocomplete="username"], #username-textfield').first().fill(username);
      await page.locator('input[type="password"]').first().fill(password);
      const [response] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/auth/api/firstfactor'),
        page.getByRole('button', {name: /Sign in|登录|登入/i}).first().click(),
      ]);
      assert.equal(response.status(), 200, 'the original password must still work');
      await page.waitForURL(url => !url.pathname.startsWith('/auth'));
    }

    async function checkAccess(page) {
      const access = await page.evaluate(async () => {
        const [catalog, admin, state] = await Promise.all([
          fetch('/api/catalog'), fetch('/api/admin/overview'), fetch('/auth/api/state'),
        ]);
        return {catalog: catalog.status, admin: admin.status,
          level: (await state.json()).data?.authentication_level,
          cache: catalog.headers.get('cf-cache-status'), control: catalog.headers.get('cache-control')};
      });
      assert.equal(access.catalog, 200, 'the planner must recognize the session');
      assert.equal(access.admin, 200, 'the admin API must recognize the same session');
      assert.equal(access.level, 1, 'the authentication portal must recognize the same session');
      assert.notEqual(access.cache, 'HIT');
      assert.match(access.control || '', /no-store/);
    }

    for (const scenario of scenarios) {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      try {
        await context.addCookies(scenario.cookies);
        await page.goto(base + '/', {waitUntil: 'domcontentloaded'});
        await page.waitForURL(url => url.pathname.startsWith('/auth'));
        assert.equal(await page.evaluate(() => fetch('/api/catalog').then(r => r.status)), 401);
        await login(page);
        await checkAccess(page);
        const cookie = (await context.cookies(base)).find(item => item.name === cookieName);
        assert(cookie, 'the configured session cookie must be present');
        secrets.push(cookie.value);
        assert.equal(cookie.secure, true);
        assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.sameSite, 'Lax');
        assert.equal(cookie.path, '/');
        await page.reload({waitUntil: 'domcontentloaded'});
        await checkAccess(page);
        assert.equal((await page.goto(base + '/admin/', {waitUntil: 'domcontentloaded'})).status(), 200);
        await checkAccess(page);
        const tab = await context.newPage();
        assert.equal((await tab.goto(base + '/', {waitUntil: 'domcontentloaded'})).status(), 200);
        await checkAccess(tab);
        await tab.close();
        if (scenario.cookies === legacy) {
          assert.equal((await context.cookies()).filter(item => item.name === 'smtvv_session').length,
            legacy.length, 'login must work with legacy cookies still in the browser');
        }

        const oldCookies = await context.cookies();
        oldCookies.forEach(item => secrets.push(item.value));
        await page.goto(base + '/auth/', {waitUntil: 'domcontentloaded'});
        const [logout] = await Promise.all([
          page.waitForResponse(r => new URL(r.url()).pathname === '/auth/api/logout'),
          page.getByRole('button', {name: /Logout|Log out|Sign out|退出|登出|注销/i}).first().click(),
        ]);
        assert.equal(logout.status(), 200);
        assert.equal(await page.evaluate(() => fetch('/api/catalog').then(r => r.status)), 401);
        const replay = await browser.newContext(options);
        try {
          await replay.addCookies(oldCookies);
          const replayPage = await replay.newPage();
          await replayPage.goto(base + '/auth/', {waitUntil: 'domcontentloaded'});
          assert.equal(await replayPage.evaluate(() => fetch('/api/admin/overview').then(r => r.status)), 401,
            'logging out must revoke the old server-side session');
        } finally { await replay.close(); }
        if (scenario.cookies === legacy) {
          await page.goto(base + '/', {waitUntil: 'domcontentloaded'});
          await login(page);
          await checkAccess(page);
          assert.equal(await page.evaluate(() => fetch('/auth/api/logout', {method: 'POST'}).then(r => r.status)), 200);
        }
        checks.push({scenario: scenario.name, passed: true,
          checks: ['login', 'planner and admin APIs', 'portal session', 'refresh', 'admin page',
            'new tab', 'secure cookie', 'logout', 'revoked cookie replay']});
        console.log('PASS: ' + scenario.name);
      } catch (error) {
        throw Error(scenario.name + ': ' + error.message);
      } finally { await context.close(); }
    }
    await fs.writeFile(path.join(__dirname, 'auth-session-validation.json'),
      JSON.stringify({base, isolated: !!proxy, passed: true, checks}, null, 2) + '\n');
  } finally {
    if (browser) await browser.close();
    if (proxy) await proxy.close();
  }
}

run().catch(error => {
  let message = error.message;
  for (const value of secrets) message = message.split(value).join('[REDACTED]');
  console.error(message);
  process.exitCode = 1;
});
