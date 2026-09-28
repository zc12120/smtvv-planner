'use strict';
const assert = require('node:assert/strict');
const {chromium} = require('./playwright.cjs');
const {useStaticFixture} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const build = {target:'Yoshitsune',skills:['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul']};

async function ready(page) {
  await page.waitForFunction(() => document.body?.dataset.catalogState === 'ready');
}
async function layout(page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => ({
    width:innerWidth,
    overflow:document.documentElement.scrollWidth > innerWidth,
    clipped:[...document.querySelectorAll('button,h1,h2,.slot-head,.slot-bottom,.resist-cell')]
      .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2)
      .map(element => element.id || element.className || element.textContent),
  }));
  assert.equal(result.overflow,false,JSON.stringify(result));
  assert.deepEqual(result.clipped,[],JSON.stringify(result));
}

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  let release;
  const errors = [], checks = [];
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN',reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    context.on('page',page => page.on('pageerror',error => errors.push(error.message)));
    // An older automatically saved skin must not obscure the new default.
    await context.addInitScript(() => {
      try {
        localStorage.setItem('smtvv-skin','p3r');
        localStorage.setItem('smtvv-theme','light');
      } catch {}
    });
    const page = await context.newPage();
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/catalog*',async route => { await gate; await route.continue(); });
    await page.route('**/api/site*',route => route.fulfill({json:{administrator:true,settings:{maintenance:false,notice:{enabled:false}}}}));
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/catalog');
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await requested;
    assert.equal(await page.locator('html').getAttribute('data-skin'),'smtv');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.locator('#skill-slots .skeleton-slot').first().waitFor({state:'visible'});
    assert.equal(await page.locator('#skill-slots .skeleton-slot:visible').count(),8);
    assert.equal(await page.locator('#skill-slots').getAttribute('aria-busy'),'true');
    assert.equal(await page.locator('.skeleton').first().evaluate(element => getComputedStyle(element,'::after').animationName),'none');
    await page.screenshot({path:__dirname+'/smtv-loading.png'});
    release();
    await ready(page);
    assert.equal(await page.locator('[data-skeleton]').count(),0);
    assert.equal(await page.locator('#skill-slots > *').count(),8);
    assert.equal(await page.locator('#skill-slots button.slot-empty:disabled').count(),8);
    assert.equal(await page.locator('#site-admin,a[href^="/admin"]').count(),0);
    checks.push('new default, real loading placeholders, reduced motion and no public administrator entry');

    await page.locator('[data-quick="Alice"]').click();
    const initial = await page.locator('.skill-slot.filled').count();
    await page.locator('[data-slot="7"]').click();
    await page.locator('#skill-search').fill('Dark Pleroma');
    await page.locator('[data-add="Dark Pleroma"]').click();
    assert.equal(await page.locator('.skill-slot.filled').count(),initial+1);
    assert.equal(await page.locator('#skill-slots > *').count(),8);
    await page.locator('[data-remove="'+initial+'"]').click();
    assert.equal(await page.locator('.skill-slot.filled').count(),initial);
    assert.equal(await page.locator('#skill-slots > *').count(),8);
    await page.locator('#slots').selectOption('6');
    assert.equal(await page.locator('.slot-empty[data-locked="true"]:disabled').count(),2);
    assert.equal(await page.locator('#skill-slots > *').count(),8);
    await page.locator('#slots').selectOption('8');
    assert.equal(await page.locator('[data-resistance="w"][data-element="lig"]').innerText(),'破魔\n弱点');
    assert.equal(await page.locator('[data-resistance="d"][data-element="dar"]').innerText(),'咒杀\n吸收');
    assert.equal(await page.locator('.resist-cell').count(),7);
    checks.push('add/remove skills preserve eight slots, locked slots cannot be selected, accurate seven-element affinities');

    await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify(build)));
    await page.waitForFunction(() => state.target === 'Yoshitsune' && state.skills.length === 8);
    for (const width of [320,390,768,1000,1280,1440,1920]) {
      await page.setViewportSize({width,height:1050});
      await layout(page);
      assert.equal(await page.locator('.skill-slot.filled').count(),8);
    }
    for (const width of [390,1000,1920]) {
      await page.setViewportSize({width,height:1050});
      await page.locator('#site-font').click();
      await layout(page);
      await page.locator('#site-font').click();
    }
    await page.setViewportSize({width:1440,height:1050});
    await page.locator('#site-theme').click();
    await page.reload(); await ready(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    for (const skin of ['p5','p3r','smtv']) {
      await page.locator('[data-skin-choice="'+skin+'"]').click();
      await layout(page);
    }
    await page.reload(); await ready(page);
    assert.equal(await page.locator('html').getAttribute('data-skin'),'smtv');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    checks.push('full build at seven widths, large text, alternate skins and remembered appearance');

    const failure = await context.newPage();
    await failure.route('**/api/catalog*',route => route.fulfill({status:503,json:{error:'Temporary catalog failure'}}));
    await failure.goto(base+'/');
    await failure.waitForFunction(() => document.body.dataset.catalogState === 'error');
    assert.equal(await failure.locator('[data-skeleton]:visible').count(),0);
    assert.equal(await failure.locator('[aria-busy="true"]').count(),0);
    assert.equal(await failure.locator('#retry-data').isVisible(),true);
    await failure.unroute('**/api/catalog*');
    await failure.locator('#retry-data').click(); await ready(failure);
    assert.equal(await failure.locator('#skill-slots > *').count(),8);
    await failure.goto(base+'/demon.html?name=Alice'); await ready(failure);
    assert.equal(await failure.locator('#entry-content').getAttribute('aria-busy'),'false');
    assert.equal(await failure.locator('.resist-cell').count(),7);
    checks.push('catalog failures clear placeholders, retry restores the build, detail pages share the affinity grid');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks}));
  } finally {
    release?.();
    await browser.close();
  }
})().catch(error => {console.error(error.stack);process.exitCode=1;});
