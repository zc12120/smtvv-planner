'use strict';
const assert = require('node:assert/strict');
const {chromium,webkit} = require('playwright');
const {useStaticFixture,fillSearch} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const errors = [];
async function ready(page) {
  await page.waitForFunction(() => document.body.dataset.catalogState === 'ready');
}
async function bounded(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),'page stays within viewport');
}
(async () => {
  for (const engine of [chromium,webkit]) {
    const browser = await engine.launch({args:engine === chromium ? ['--no-sandbox','--no-proxy-server'] : []});
    try {
      const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
      await useStaticFixture(context,base);
      const page = await context.newPage();
      page.on('pageerror',error => errors.push(error.message));
      await page.goto(base+'/?tab=demons',{waitUntil:'domcontentloaded'});await ready(page);
      const kinds = [['demons','demon','Fairy','全部种族'],['skills','skill','fir','全部类别'],['essences','essence','aogami','全部类别']];
      for (const [tab,kind,value,label] of kinds) {
        await page.locator('[data-tab="'+tab+'"]').click();
        const heading = page.locator('#tab-'+tab+' .catalog-index-heading');
        const trigger = heading.locator('.catalog-category-toggle');
        const selection = heading.locator('.catalog-index-selection');
        const title = {demons:'种族',skills:'技能类别',essences:'灵体分类'}[tab];
        assert.equal(await heading.locator('.catalog-index-label').innerText(),title);
        assert.equal(await selection.innerText(),label);
        await heading.locator('.catalog-index-label').click();
        assert.equal(await trigger.getAttribute('aria-expanded'),'false','passive label does not open categories');
        await trigger.press('Enter');
        const attribute = kind === 'demon' ? 'race' : kind;
        const category = page.locator('[data-'+attribute+'-category="'+value+'"]');
        const selected = await category.locator('.category-label > span').innerText();
        await category.click();
        assert.equal(await selection.innerText(),selected);
        assert.equal(await trigger.getAttribute('aria-expanded'),'false');
        assert(await trigger.evaluate(e=>document.activeElement===e),'mobile selection returns focus to category button');
        await trigger.press('Space');
        assert.equal(await trigger.getAttribute('aria-expanded'),'true');
        await category.focus();
        await page.keyboard.press('Escape');
        assert.equal(await trigger.getAttribute('aria-expanded'),'false');
        assert(await trigger.evaluate(e=>document.activeElement===e));
        await page.reload({waitUntil:'domcontentloaded'});await ready(page);
        assert.equal(await selection.innerText(),selected,'selected category survives reload');
        await page.locator('[data-reset-catalog="'+tab+'"]').click();
        assert.equal(await selection.innerText(),label,'reset restores all categories');
        const input = page.locator('#'+kind+'-filter');
        assert.equal(await input.isVisible(),false);
        assert.equal(await input.getAttribute('placeholder'),null);
        await fillSearch(page,kind+'-filter','no-such-search-fixture');
        assert.equal(await page.locator('#tab-'+tab+' .catalog-card').count(),0);
        const box = await input.boundingBox();
        assert(box.width >= 270,'library input expands across the phone content');
        await input.press('Escape');
        assert.equal(await input.isVisible(),false);
        assert.equal(await page.locator('#tab-'+tab+' .search-query-label').innerText(),'no-such-search-fixture');
        await page.locator('#tab-'+tab+' [data-open-search]').click();
        await page.locator('#'+kind+'-query [data-clear-search]').click();
        assert((await page.locator('#tab-'+tab+' .catalog-card').count())>0);
        await page.locator('[data-reset-catalog="'+tab+'"]').click();
      }
      await page.locator('[data-tab="demons"]').click();
      await fillSearch(page,'demon-filter','Pixie');
      const card = page.locator('[data-demon-name="Pixie"]');
      await card.locator('[data-catalog-preview]').click();
      await page.locator('#catalog-preview[open]').waitFor();
      await page.keyboard.press('Escape');
      await card.locator('.record-art').click();
      await page.locator('.entry-heading').waitFor();
      await page.locator('#detail-back').click();await ready(page);
      assert.equal(await page.locator('#demon-filter').inputValue(),'Pixie');
      assert.equal(await page.locator('#tab-demons .search-query-label').innerText(),'Pixie','restored query remains visible even with collapsed input');
      await page.locator('[data-reset-catalog="demons"]').click();
      for (const width of [320,390,768,1440]) {
        await page.setViewportSize({width,height:844});
        await page.locator('.header-search-button').click();
        assert(await page.locator('#global-search').evaluate(e=>document.activeElement===e));
        assert.equal(await page.locator('#global-search').getAttribute('placeholder'),null);
        await fillSearch(page,'global-search','Ｐｉｘｉｅ');
        await page.locator('#global-results a').first().waitFor();
        assert.equal(await page.locator('#global-results a[href^="/demon.html?name=Pixie&"]').count(),1);
        const dialog = await page.locator('#site-search-dialog').boundingBox();
        const results = await page.locator('#global-results').boundingBox();
        assert(dialog.x >= 0 && dialog.x+dialog.width <= width,'dialog fits viewport');
        assert(results.width >= Math.min(width-96,690),`results use a spacious panel (${width}px: ${results.width}px)`);
        await bounded(page);
        await page.locator('#global-search').press('Escape');
        assert.equal(await page.locator('#site-search-dialog').evaluate(e=>e.open),false);
        assert(await page.locator('.header-search-button').evaluate(e=>document.activeElement===e));
        await page.keyboard.press('/');
        await page.locator('#site-search-dialog[open]').waitFor();
        assert.equal(await page.locator('#global-search').inputValue(),'Ｐｉｘｉｅ','closing preserves search');
        await page.locator('#site-search-dialog [data-clear-search]').click();
        assert.equal(await page.locator('#global-search').inputValue(),'');
        assert.equal(await page.locator('#global-results').isVisible(),false);
        await fillSearch(page,'global-search','Pixie');
        await page.locator('#global-search').press('ArrowDown');
        assert(await page.locator('#global-results a').first().evaluate(e=>document.activeElement===e));
        await page.keyboard.press('Escape');
      }
      for (const skin of ['smtv','p5','p3r']) {
        await page.evaluate(skin=>document.documentElement.dataset.skin=skin,skin);
        for (const theme of ['light','dark']) {
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
          await page.setViewportSize({width:390,height:844});
          await page.locator('.header-search-button').click();
          await fillSearch(page,'global-search','Pixie');
          await bounded(page);
          await page.keyboard.press('Escape');
        }
      }
      await page.evaluate(()=>{document.documentElement.dataset.skin='smtv';document.documentElement.dataset.theme='light';});
      await page.locator('.header-search-button').click();
      await fillSearch(page,'global-search','Pixie');
      if (engine === chromium) {
        await page.screenshot({path:'/tmp/smtvv-search-mobile.png'});
        await page.keyboard.press('Escape');
        await fillSearch(page,'demon-filter','Pixie');
        await page.screenshot({path:'/tmp/smtvv-filter-mobile.png'});
        await page.setViewportSize({width:1440,height:1000});
        await page.locator('.header-search-button').click();
        await page.screenshot({path:'/tmp/smtvv-search-desktop.png'});
      }
      console.log(engine.name()+': categories, reset/restoration, search entry, query clearing, wide results, keyboard/focus, 320–1440px, themes and independent card actions passed');
    } finally { await browser.close(); }
  }
  assert.deepEqual(errors,[]);
})().catch(error=>{console.error(error);process.exitCode=1;});
