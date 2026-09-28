'use strict';
const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const {useStaticFixture} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';

(async () => {
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#config=' + encodeURIComponent(JSON.stringify({target:'Angel',skills:['Dia']})));
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
    const catalog = await page.evaluate(() => GameSite.catalog.then(d => ({count:d.demons.length,assets:d.assets,source:d.demonProfileSource.kind})));
    assert.equal(catalog.count,275);
    await page.locator('#calculate').click();
    await page.waitForFunction(() => window.currentPage?.finished,{}, {timeout:30000});
    assert.equal(await page.evaluate(() => currentPage.complete),true);
    assert.equal(await page.locator('.strategy').count(),3);
    assert.deepEqual(errors,[]);
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,broken:[...document.images].filter(x=>x.getClientRects().length&&x.complete&&!x.naturalWidth).map(x=>x.getAttribute('src'))}));
    assert.equal(layout.overflow,false);
    assert.deepEqual(layout.broken,[]);
    await page.screenshot({path:__dirname+'/open-source-route.png'});
    // A revoked/expired session gives one actionable prompt and keeps configuration.
    const saved=await page.evaluate(()=>localStorage.getItem('smtvv-config-v1'));
    assert(saved && JSON.parse(saved).target==='Angel');
    await page.route('**/api/catalog?expired-test=1',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"登录已过期"}'}));
    const message=await page.evaluate(()=>GameSite.fetchJson('/api/catalog?expired-test=1','资料读取失败').catch(e=>e.message));
    assert.match(message,/登录已过期/);
    assert.equal(await page.locator('#auth-notice a').textContent(),'重新登录');
    assert.equal(await page.evaluate(()=>localStorage.getItem('smtvv-config-v1')),saved);
    console.log(JSON.stringify({ok:true,catalog,scenarios:['catalog','calculation','layout','session-expiry']}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
