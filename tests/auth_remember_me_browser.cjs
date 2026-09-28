'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const playwright = require('playwright');
const secrets = [];

async function run() {
  const base = new URL(process.env.SMTVV_URL || 'https://planner.example.com').origin;
  assert(base.startsWith('https://'), 'Authentication tests require HTTPS');
  const filename = process.env.SMTVV_CREDENTIALS_FILE || path.join(__dirname, '../runtime/credentials.txt');
  const credentials = fs.readFileSync(filename === '-' ? 0 : filename, 'utf8');
  const username = credentials.match(/^Username:\s*(\S+)$/m)?.[1];
  const password = credentials.match(/^Password:\s*(\S+)$/m)?.[1];
  if (!username || !password) throw Error('Private credentials input is incomplete');
  secrets.push(username, password);
  const cookieName = process.env.SMTVV_SESSION_COOKIE ||
    'smtvv_session_' + createHash('sha256').update(base).digest('hex').slice(0, 12);
  const engine = process.env.SMTVV_BROWSER || 'chromium';
  assert(['chromium', 'firefox', 'webkit'].includes(engine), 'Unsupported browser');
  const browser = await playwright[engine].launch({headless: true,
    ...(engine === 'chromium' ? {args: ['--no-sandbox'],
      channel: process.env.SMTVV_CHROME_CHANNEL || undefined,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined} : {})});
  const checks = [];
  try {
    for (const keepMeLoggedIn of [true, false]) {
      const context = await browser.newContext({locale: 'zh-CN', viewport: {width: 1440, height: 1000}});
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        // Exercise both requests, including a stale tab sending true after an
        // administrator disables remember-me. The real server enforces policy.
        await context.route(base + '/auth/api/firstfactor', route => {
          const data = route.request().postDataJSON();
          return route.continue({postData: JSON.stringify({...data, keepMeLoggedIn})});
        });
        await page.goto(base + '/', {waitUntil: 'domcontentloaded'});
        const policy = await page.evaluate(() => fetch('/api/login/options', {cache:'no-store'}).then(r => r.json()).then(data => data.settings));
        await page.locator('input[autocomplete="username"], #username-textfield').first().fill(username);
        await page.locator('input[type="password"]').first().fill(password);
        const rememberOptions = await page.getByRole('checkbox').count();
        const [login] = await Promise.all([
          page.waitForResponse(r => new URL(r.url()).pathname === '/auth/api/firstfactor'),
          page.getByRole('button', {name: /Sign in|登录|登入/i}).first().click(),
        ]);
        assert.equal(login.status(), 200, 'the original credentials must work');
        const browserCookie = (await context.cookies(base)).find(item => item.name === cookieName);
        assert(browserCookie && browserCookie.expires > Date.now() / 1000, 'login cookie has an absolute expiry');
        const lifetimeSeconds = browserCookie.expires - Date.now() / 1000;
        assert(lifetimeSeconds >= 290,
          'login cookie expires after ' + lifetimeSeconds + 's with keepMeLoggedIn=' + keepMeLoggedIn);
        const expectedLifetime = (policy.rememberMeEnabled && keepMeLoggedIn ? policy.rememberMinutes : policy.sessionMinutes) * 60;
        assert(Math.abs(lifetimeSeconds - expectedLifetime) <= 5, 'the actual cookie must use the configured normal/remembered lifetime');
        assert.equal(rememberOptions, Number(policy.rememberMeEnabled) + Number(policy.rememberPasswordEnabled), 'login options follow administrator settings');
        await page.waitForURL(url => !url.pathname.startsWith('/auth'));
        // Cross the former one-second expiry before checking any success.
        await page.waitForTimeout(2500);
        const cookie = (await context.cookies(base)).find(item => item.name === cookieName);
        assert(cookie, 'the browser must retain the authenticated cookie');
        secrets.push(cookie.value);
        assert.equal(cookie.secure, true);
        assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.sameSite, 'Lax');
        async function checkAccess(target) {
          const result = await target.evaluate(async () => {
            const rows = [];
            for (const url of ['/api/catalog', '/api/admin/overview', '/auth/api/state']) {
              const response = await fetch(url);
              const row = {url, status: response.status, cache: response.headers.get('cf-cache-status')};
              if (url === '/auth/api/state') row.level = (await response.json()).data?.authentication_level;
              rows.push(row);
            }
            return rows;
          });
          assert(result.every(row => row.status === 200 && row.cache !== 'HIT'));
          assert.equal(result[2].level, 1);
        }
        await checkAccess(page);
        await page.reload({waitUntil: 'domcontentloaded'});
        await checkAccess(page);
        const tab = await context.newPage();
        assert.equal((await tab.goto(base + '/admin/', {waitUntil: 'domcontentloaded'})).status(), 200);
        await checkAccess(tab);
        await tab.close();
        const oldCookies = await context.cookies(base);
        assert.equal(await page.evaluate(() => fetch('/auth/api/logout', {method: 'POST'}).then(r => r.status)), 200);
        assert.equal(await page.evaluate(() => fetch('/api/catalog').then(r => r.status)), 401);
        const replay = await browser.newContext();
        try {
          await replay.addCookies(oldCookies);
          const oldTab = await replay.newPage();
          await oldTab.goto(base + '/auth/', {waitUntil: 'domcontentloaded'});
          assert.equal(await oldTab.evaluate(() => fetch('/api/admin/overview').then(r => r.status)), 401);
        } finally { await replay.close(); }
        checks.push({keepMeLoggedIn, lifetimeSeconds, passed: true,
          checks: ['real login', 'cookie lifetime', 'planner and admin access after expiry boundary',
            'refresh', 'new admin tab', 'logout', 'revoked cookie replay']});
      } finally { await context.close(); }
    }
    const report = {passed: true, base, engine, version: browser.version(), checks};
    const output = process.env.SMTVV_TEST_REPORT || path.join(__dirname, 'auth-remember-me-' + engine + '-validation.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}

run().catch(error => {
  let message = error.message;
  for (const secret of secrets) if (secret) message = message.split(secret).join('[REDACTED]');
  console.error(message);
  process.exitCode = 1;
});
