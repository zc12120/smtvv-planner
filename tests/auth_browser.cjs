'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {chromium} = require('./playwright.cjs');
const secrets = [];

async function run() {
  const base = new URL(process.env.SMTVV_URL || 'https://planner.example.com').origin;
  assert(base.startsWith('https://'),'Authentication tests require an HTTPS origin');
  const cookieName = process.env.SMTVV_SESSION_COOKIE ||
    'smtvv_session_' + createHash('sha256').update(base).digest('hex').slice(0,12);
  const credentials = await fs.readFile(process.env.SMTVV_CREDENTIALS_FILE || path.join(__dirname,'../runtime/credentials.txt'),'utf8');
  const username = credentials.match(/^Username:\s*(\S+)$/m)?.[1];
  const password = credentials.match(/^Password:\s*(\S+)$/m)?.[1];
  if (!username || !password) throw Error('Expected a private credentials file with Username and Password fields');
  secrets.push(password,password+'-incorrect');
  let proxy, browser, page;
  const useLocalFonts=!!process.env.SMTVV_TEST_UPSTREAM && process.env.SMTVV_TEST_LOCAL_FONTS!=='0';
  const checks = [];
  const networkFailures=[];
  const errors = [];
  try {
    const args = ['--no-sandbox'];
    if (process.env.SMTVV_TEST_UPSTREAM) {
      proxy = await require('./tls_proxy.cjs')(new URL(base).hostname,process.env.SMTVV_TEST_UPSTREAM);
      args.push('--no-proxy-server','--host-resolver-rules=MAP '+new URL(base).hostname+' 127.0.0.1:'+proxy.port);
    }
    browser = await chromium.launch({headless:true,args});
    const options = {viewport:{width:1440,height:1000},locale:'zh-CN',reducedMotion:'reduce',ignoreHTTPSErrors:!!proxy};
    const context = await browser.newContext(options);
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('requestfailed',request=>networkFailures.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText}));
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await page.waitForURL(url=>url.pathname.startsWith('/auth/'));
    checks.push('anonymous page redirects to login');
    const anonymous = await page.evaluate(async()=>{
      const results=[];
      for (const [url,options] of [
        ['/api/catalog',{}],
        ['/api/catalog',{headers:{'Remote-User':'forged-admin','X-Forwarded-User':'forged-admin'}}],
        ['/api/optimal/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"target":"Angel","skills":["Dia"]}'}],
      ]) {
        const response=await fetch(url,options);
        results.push({status:response.status,cache:response.headers.get('cf-cache-status'),control:response.headers.get('cache-control')});
      }
      for (const url of ['/site.js?v=review-20260912-1','/assets/planner-icon.svg','/assets/demons/manifest.json','/assets/fonts/noto-sans-sc.woff2']) {
        const response=await fetch(url,{redirect:'manual'});
        results.push({status:response.status,type:response.type});
      }
      return results;
    });
    for (const result of anonymous.slice(0,3)) {
      assert.equal(result.status,401);
      assert.notEqual(result.cache,'HIT');
      assert.match(result.control || '',/no-store/);
    }
    for (const result of anonymous.slice(3)) assert.equal(result.type,'opaqueredirect');
    checks.push('anonymous API, forged identity and static assets are blocked');

    const userField=page.locator('input[autocomplete="username"], input[name="username"], #username-textfield').first();
    const passField=page.locator('input[type="password"]').first();
    const signIn=page.getByRole('button',{name:/Sign in|登录|登入/i}).first();
    await userField.fill(username);
    await passField.fill(password+'-incorrect');
    const [wrong] = await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/api/firstfactor'),
      signIn.click(),
    ]);
    assert.equal(wrong.status(),401);
    checks.push('wrong password is rejected');
    if(useLocalFonts) {
      // A multi-megabyte font can saturate a single SSH tunnel and delay script
      // requests past their timeout. Only in the isolated transport fixture,
      // read the identical local fonts after checking their anonymous denial.
      // HTML, scripts, login, APIs and all production checks use real delivery.
      await page.route('**/assets/fonts/*.woff2',route=>route.fulfill({
        path:path.join(__dirname,'../web/assets/fonts',path.basename(new URL(route.request().url()).pathname)),
        contentType:'font/woff2',headers:{'Cache-Control':'no-store'},
      }));
    }
    await passField.fill(password);
    const [signedIn] = await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/api/firstfactor'),
      signIn.click(),
    ]);
    assert.equal(signedIn.status(),200);
    await page.waitForURL(url=>!url.pathname.startsWith('/auth/'));
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('275'),{}, {timeout:45000});
    const cookie=(await context.cookies(base)).find(item=>item.name===cookieName);
    assert(cookie,'Authenticated session cookie exists');
    secrets.push(cookie.value);
    assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Lax');
    assert.equal(await page.getByRole('link',{name:'账户与退出登录'}).count(),1);
    checks.push('login and Secure/HttpOnly/SameSite session cookie');

    // Chromium owns the Origin header, even when requests are intercepted.
    // Use the same session with an explicit HTTP client to test this boundary.
    const requestCookies=await context.cookies(base);
    requestCookies.forEach(item=>secrets.push(item.value));
    const requestBase=proxy?'https://127.0.0.1:'+proxy.port:base;
    const requestHeaders={Host:new URL(base).host,
      Cookie:requestCookies.map(item=>item.name+'='+item.value).join('; '),
      'User-Agent':await page.evaluate(()=>navigator.userAgent),Referer:base+'/'};
    const control=await context.request.get(requestBase+'/api/catalog',{headers:requestHeaders});
    assert.equal(control.status(),200,'the explicit client has an authenticated session');
    for (const origin of ['https://sibling.example.com','null']) {
      const csrf=await context.request.post(requestBase+'/api/optimal/start',{
        headers:{...requestHeaders,Origin:origin},data:{target:'Angel',skills:['Dia']},
      });
      assert.equal(csrf.status(),403);
    }
    checks.push('authenticated foreign-origin mutation is rejected');
    await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify({target:'Angel',skills:['Dia']})));
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('275'));
    await page.locator('#calculate').click();
    await page.waitForFunction(()=>window.currentPage?.finished,{}, {timeout:45000});
    assert.equal(await page.evaluate(()=>currentPage.complete),true);
    assert.equal(await page.locator('.strategy').count(),3);
    await page.screenshot({path:__dirname+'/auth-route.png'});
    checks.push('authenticated calculation produces three valid routes');

    const oldCookies=await context.cookies(base);
    oldCookies.forEach(item=>secrets.push(item.value));
    await page.getByRole('link',{name:'账户与退出登录'}).click();
    await page.waitForURL(url=>url.pathname.startsWith('/auth/'));
    const logout=page.getByRole('button',{name:/Logout|Log out|Sign out|退出|登出|注销/i}).first();
    const [loggedOut]=await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/api/logout'),
      logout.click(),
    ]);
    assert.equal(loggedOut.status(),200);
    // The site portal navigates to a fresh login document after logout.
    await page.locator('#username-textfield').waitFor({state:'visible'});
    await page.locator('#login-fields:not([disabled])').waitFor();
    const afterLogout=await page.evaluate(()=>fetch('/api/catalog').then(response=>response.status));
    assert.equal(afterLogout,401);
    const replay=await browser.newContext(options);
    await replay.addCookies(oldCookies);
    const replayPage=await replay.newPage();
    await replayPage.goto(base+'/auth/');
    assert.equal(await replayPage.evaluate(()=>fetch('/api/catalog').then(response=>response.status)),401);
    await replay.close();
    checks.push('logout invalidates the old server-side session');
    assert.deepEqual(errors,[]);
    const report={ok:true,url:base,isolatedGateway:!!proxy,localFontFixture:useLocalFonts,checks};
    await fs.writeFile(__dirname+'/auth-validation.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } catch(error) {
    if(page) {
      await page.screenshot({path:__dirname+'/auth-failure.png'}).catch(()=>{});
      const diagnostic=await page.evaluate(()=>({path:location.pathname,text:document.body.innerText.slice(0,1800),
        status:document.querySelector('#status')?.textContent})).catch(()=>({}));
      error.stack += '\n'+JSON.stringify({completed:checks,diagnostic,errors,networkFailures:networkFailures.slice(-12)});
    }
    throw error;
  } finally {
    if(browser)await browser.close();
    if(proxy)await proxy.close();
  }
}

run().catch(error=>{
  let message=error.stack || String(error);
  for (const secret of secrets) if(secret)message=message.split(secret).join('[REDACTED]');
  console.error(message);process.exitCode=1;
});
