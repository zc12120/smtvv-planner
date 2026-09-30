'use strict';
const assert = require('node:assert/strict');
const {chromium} = require('./playwright.cjs');
const {useStaticFixture,fillSearch} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const checks = [], errors = [];
const ready = async page => {
  await page.waitForFunction(() => document.body.dataset.catalogState === 'ready');
  await page.evaluate(() => document.fonts.ready);
};
const tab = async (page, kind) => {
  await page.locator(`[data-tab="${kind}"]`).click();
  await page.locator(`#tab-${kind}`).waitFor({state:'visible'});
};

(async () => {
  assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname), 'Use an isolated local server');
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    context.on('page',page => page.on('pageerror',error => errors.push(error.message)));
    const page = await context.newPage();
    await page.goto(base); await ready(page);
    const totals = await page.evaluate(async () => {
      const data = await GameSite.catalog;
      return Object.fromEntries(['demons','skills','essences'].map(kind => [kind,data[kind].length]));
    });

    await fillSearch(page,'global-search','Ｐｉｘｉｅ');
    assert.equal(await page.locator('#global-results a[href^="/demon.html?name=Pixie&"]').count(),1);
    await page.keyboard.press('Escape');
    await fillSearch(page,'global-search','电击增幅');
    const innateSkill = page.locator('#global-results a[href^="/skill.html?name=Elec%20Enhancer&"]');
    assert.equal(await innateSkill.count(),1,'global search includes demon innate/passive skills');
    assert.match(await innateSkill.innerText(),/电击增幅/);
    await innateSkill.click();
    await page.locator('.entry-heading').waitFor();
    assert.match(await page.locator('h1').innerText(),/电击增幅/);
    await page.locator('#detail-back').click(); await ready(page);
    await page.locator('#target-search').fill('Artemis');
    assert.equal(await page.locator('#target-results [data-demon]').count(),1);
    await page.locator('#target-search').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
    assert.equal(await page.evaluate(() => state.target),'','IME confirmation must not select a demon');
    await page.locator('#target-search').press('Enter');
    assert.equal(await page.evaluate(() => state.target),'Artemis');
    checks.push('full-width and innate-skill search work; IME confirmation preserves the intended target');

    const physicalNames = ['Drain Phys','High Phys Pleroma','Null Phys','Phys Block','Phys Pleroma','Repel Phys','Resist Phys'].sort();
    await page.locator('.slot-empty:not(:disabled)').first().click();
    for (const query of ['物理','Ｐｈｙｓ']) {
      await page.locator('#skill-search').fill(query);
      assert.deepEqual(await page.locator('#skill-options [data-add]').evaluateAll(items => items.map(item => item.dataset.add).sort()),physicalNames,'skill picker matches names only, including normalized English names');
    }
    await page.locator('#skill-search').fill('物理');
    await page.locator('#elements [data-element="phy"]').click();
    assert.equal(await page.locator('#skill-options [data-add]').count(),0,'physical category does not broaden the name query');
    await page.locator('#skill-search').fill('');
    assert(await page.locator('#skill-options [data-add]').count()>0,'category filtering still works without a name query');
    await page.locator('#elements [data-element=""]').click();
    await page.locator('#skill-search').fill('对敌方全体');
    assert.equal(await page.locator('#skill-options [data-add]').count(),0,'effect-only keywords do not match');
    await page.locator('#close-dialog').click();
    await tab(page,'skills');
    await fillSearch(page,'skill-filter','物理');
    assert.deepEqual(await page.locator('.skill-record').evaluateAll(items => items.map(item => item.dataset.skillName).sort()),physicalNames,'skill archive uses the same name-only rule');
    await fillSearch(page,'skill-filter','对敌方全体');
    assert.equal(await page.locator('.skill-record').count(),0);
    await fillSearch(page,'global-search','物理');
    const globalSkills = await page.locator('#global-results a[href^="/skill.html"] .search-result-name').allTextContents();
    assert.equal(globalSkills.length,5);
    assert(globalSkills.every(name => name.includes('物理')),'global skill suggestions match the name, not category or effect');
    await page.keyboard.press('Escape');
    await page.locator('[data-reset-catalog="skills"]').click();
    checks.push('skill picker, archive and global suggestions match names only; category filters remain independent');

    await tab(page,'demons');
    const pixie = await page.locator('[data-demon-name="Pixie"]').elementHandle();
    await fillSearch(page,'demon-filter','Ｐｉｘｉｅ');
    assert.equal(await page.locator('.demon-record').count(),2);
    assert(await pixie.evaluate(node => node === document.querySelector('[data-demon-name="Pixie"]')));
    await fillSearch(page,'demon-filter','no-such-record-fixture');
    assert.equal(await page.locator('.demon-record').count(),0);
    await fillSearch(page,'demon-filter','');
    assert(await pixie.evaluate(node => node === document.querySelector('[data-demon-name="Pixie"]')),'reset reuses the original record');
    assert.equal(await page.locator('.demon-record').count(),totals.demons);
    await pixie.dispose();
    await fillSearch(page,'demon-filter','Pixie');
    await page.locator('[data-catalog-columns="demons"]').selectOption('3');
    const preview = page.locator('[data-demon-name="Pixie"] [data-catalog-preview]');
    await preview.click();
    assert.equal(await page.locator('#catalog-preview').evaluate(node => getComputedStyle(node).animationName),'none');
    assert.equal(await page.locator('#catalog-preview .resist-cell').count(),7);
    assert.equal(await page.locator('#catalog-preview .innate').count(),1);
    assert.equal(await page.locator('#catalog-preview .primary').getAttribute('href'),'/?tab=planner&target=Pixie');
    await page.keyboard.press('Escape');
    assert(await preview.evaluate(node => document.activeElement === node));
    checks.push('filtered records survive empty/reset; complete previews respect reduced motion and restore focus');

    for (const kind of ['skills','essences','skills','demons']) {
      await tab(page,kind);
      assert.equal(await page.locator('.collection-grid').count(),1,'only the active collection stays mounted');
      assert.equal(await page.locator('.catalog-card').count(),kind === 'demons' ? 2 : totals[kind]);
    }
    assert.equal(await page.locator('#demon-filter').inputValue(),'Pixie');
    assert.equal(await page.locator('[data-catalog-columns="demons"]').inputValue(),'3');
    checks.push('repeated navigation releases inactive collections and restores independent filters/density');

    await page.locator('[data-reset-catalog="demons"]').click();
    await page.locator('[data-catalog-columns="demons"]').selectOption('auto');
    await page.evaluate(() => window.scrollTo(0,12000));
    const readingPosition = () => {
      const card = document.elementFromPoint(450,160)?.closest('.demon-record');
      return {name:card?.dataset.demonName,top:card?.getBoundingClientRect().top};
    };
    const before = await page.evaluate(readingPosition);
    assert(before.name,'deep reading position is on a demon card');
    await tab(page,'skills'); await tab(page,'demons');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const after = await page.evaluate(readingPosition);
    assert.equal(after.name,before.name,'returning to a long collection shows the same record');
    assert(Math.abs(after.top-before.top)<2,'reading position remains stable after remounting');
    await page.evaluate(() => window.scrollTo(0,0));
    checks.push('deep collection scroll restores the same record and pixel position');

    const other = await context.newPage();
    await other.goto(base+'/?tab=skills'); await ready(other);
    await page.locator('#site-font').click();
    await other.waitForFunction(() => document.documentElement.dataset.font === 'large');
    await other.evaluate(() => localStorage.removeItem('smtvv-font'));
    await page.waitForFunction(() => document.documentElement.dataset.font === 'standard');
    await other.close();
    await tab(page,'planner');
    await page.locator('#build-tab').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#route-tab').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#build-tab').getAttribute('tabindex'),'-1');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#build-tab').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#planner-build').isVisible(),true);
    checks.push('font changes synchronize across tabs; planner tabs support roving keyboard focus');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
