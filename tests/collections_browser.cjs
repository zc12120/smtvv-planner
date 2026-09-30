'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('./playwright.cjs');
const {useStaticFixture,fillSearch} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const checks = [], errors = [];
const types = {demons:'.demon-record', skills:'.skill-record', essences:'.essence-record'};

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
  await page.evaluate(() => document.fonts.ready);
}
async function tab(page, kind) {
  await page.locator('[data-tab="'+kind+'"]').click();
  await page.locator(types[kind]).first().waitFor();
}
async function firstRowCount(page, kind) {
  return page.locator(types[kind]).evaluateAll(cards => {
    const top = cards[0].getBoundingClientRect().top;
    return cards.filter(card => Math.abs(card.getBoundingClientRect().top - top) < 1).length;
  });
}
async function skillOrder(page) {
  const result = await page.evaluate(() => {
    const index = [...document.querySelectorAll('[data-skill-category]')].map(button => button.dataset.skillCategory).filter(Boolean);
    const affinities = [...document.querySelectorAll('.skill-record')].map(card => card.dataset.affinity);
    return {expected:index.filter(element => affinities.includes(element)),groups:affinities.filter((element,i) => !i || element !== affinities[i-1])};
  });
  assert.deepEqual(result.groups,result.expected,'skill groups follow the visible attribute index without interleaving');
  return result.groups;
}
async function displaySettings(page) {
  if (!(await page.locator('#site-font').isVisible())) await page.locator('.display-menu > summary').click();
}
async function layout(page, label) {
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => ({
    overflow:document.documentElement.scrollWidth > innerWidth,
    clipped:[...document.querySelectorAll('button,h1,h2,h3,.resist-cell')]
      .filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 2)
      .map(e => ({text:e.textContent.slice(0,80),width:e.clientWidth,content:e.scrollWidth})),
  }));
  assert.equal(result.overflow,false,label+': horizontal overflow');
  assert.deepEqual(result.clipped,[],label+': clipped names or controls');
}
async function preview(page, card) {
  const button = card.locator('[data-catalog-preview]');
  await button.focus();
  await page.keyboard.press('Enter');
  await page.locator('#catalog-preview[open]').waitFor();
  assert.equal(await button.getAttribute('aria-expanded'),'true');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-close-preview')),true);
  assert.equal(await page.locator('#catalog-preview-title').isVisible(),true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('preview-open'));
  assert.equal(await page.locator('#catalog-preview').evaluate(e => e.open),false);
  assert.equal(await button.evaluate(e => document.activeElement === e),true,'Escape returns focus to its preview button');
  assert.equal(await button.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('body').evaluate(e => e.classList.contains('preview-open')),false);
}

(async () => {
  assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Run collection fixtures against an isolated local server');
  const browser = await chromium.launch({args:['--no-sandbox']});
  let page;
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    context.on('page',p => p.on('pageerror',error => errors.push(error.message)));
    page = await context.newPage();
    await page.goto(base+'/?lang=en'); await ready(page);
    const totals = await page.evaluate(async () => {
      const data = await GameSite.catalog;
      return {demons:data.demons.length,skills:data.skills.length,essences:data.essences.length};
    });
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    assert.equal(await page.locator('html').getAttribute('data-skin'),'smtv');
    assert.equal(await page.locator('.display-controls a[href^="/auth"],#site-admin').count(),0);
    for (const kind of Object.keys(types)) {
      await tab(page,kind);
      assert.equal(await page.locator(types[kind]).count(),totals[kind],kind+': all records are available');
    }

    const originalBuild = await page.evaluate(() => state);
    const columnChoices = {demons:'3',skills:'2',essences:'4'};
    for (const [kind,value] of Object.entries(columnChoices)) {
      await tab(page,kind);
      const control = page.locator('[data-catalog-columns="'+kind+'"]');
      assert.equal(await control.inputValue(),'auto');
      const firstCard = await page.locator(types[kind]).first().elementHandle();
      await control.focus(); await control.selectOption(value);
      assert.equal(await firstRowCount(page,kind),Number(value),kind+': selected cards per row');
      assert(await firstCard.evaluate(card => card.isConnected),'changing columns keeps existing cards');
      assert(await control.evaluate(element => document.activeElement === element),'column selection keeps keyboard focus');
      await firstCard.dispose();
    }
    await page.reload(); await ready(page);
    for (const [kind,value] of Object.entries(columnChoices)) {
      await tab(page,kind);
      assert.equal(await page.locator('[data-catalog-columns="'+kind+'"]').inputValue(),value,'each collection remembers its own setting');
      assert.equal(await firstRowCount(page,kind),Number(value));
    }
    assert.deepEqual(await page.evaluate(() => state),originalBuild,'layout preferences do not change the build');
    await tab(page,'demons');
    await fillSearch(page,'demon-filter','no-such-column-fixture');
    await page.locator('[data-catalog-columns="demons"]').selectOption('5');
    await page.locator('[data-reset-catalog="demons"]').click();
    assert.equal(await page.locator('[data-catalog-columns="demons"]').inputValue(),'5','filter reset preserves layout');
    assert.equal(await firstRowCount(page,'demons'),5,'a preference selected while empty applies to returning results');
    await page.locator('[data-catalog-columns="demons"]').selectOption('3');
    await page.setViewportSize({width:320,height:1000});
    assert.equal(await firstRowCount(page,'demons'),1,'narrow screens keep cards readable');
    assert.equal(await page.locator('[data-catalog-columns="demons"]').inputValue(),'3','the wider-screen preference is retained');
    await page.setViewportSize({width:1440,height:1000});
    assert.equal(await firstRowCount(page,'demons'),3,'widening the viewport restores the chosen density');
    await page.setViewportSize({width:1920,height:1000});
    await page.locator('#site-font').click();
    await page.locator('[data-catalog-columns="demons"]').selectOption('6');
    assert.equal(await firstRowCount(page,'demons'),6);
    await layout(page,'large text / six columns');
    const affinityLabels = await page.locator('.demon-record .resist-value').evaluateAll(labels => labels.map(label => {
      const range = document.createRange(); range.selectNodeContents(label);
      return {text:label.textContent,lines:range.getClientRects().length};
    }).filter(label => label.lines > 1));
    assert.deepEqual(affinityLabels,[],'resistance words stay on a single line even in dense cards');
    const statusColors = await page.evaluate(() => ['s','n'].map(code => {
      const style = getComputedStyle(document.querySelector('.demon-record [data-resistance="'+code+'"]'));
      return style.color + '/' + style.backgroundColor;
    }));
    assert.notEqual(statusColors[0],statusColors[1],'resistance and immunity have distinct treatments');
    await page.locator('#site-font').click();
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(() => localStorage.setItem('smtvv-catalog-columns-v1',JSON.stringify({demons:'99',skills:'2;display:none',essences:null})));
    await page.reload(); await ready(page);
    for (const kind of Object.keys(types)) assert.equal(await page.locator('[data-catalog-columns="'+kind+'"]').inputValue(),'auto','invalid saved values fall back to automatic');
    checks.push('independent row limits persist, preserve filters/build/focus, adapt to narrow screens and recover from invalid storage; dense affinity labels remain complete');

    await tab(page,'demons');
    const fairy = page.locator('[data-race-category="Fairy"]');
    await fairy.focus(); await page.keyboard.press('Enter');
    assert.equal(await fairy.evaluate(e => document.activeElement === e),true,'category filtering preserves keyboard focus');
    assert.equal(await fairy.getAttribute('aria-pressed'),'true');
    await fillSearch(page,'demon-filter','Pixie');
    assert.equal(await page.locator('.demon-record').count(),2);
    const pixie = page.locator('[data-demon-name="Pixie"]');
    assert.equal(await pixie.locator('.resist-cell[aria-label]').count(),7);
    await preview(page,pixie);
    await pixie.locator('[data-catalog-preview]').click();
    await page.locator('#catalog-preview .inspector-link').click();
    await page.locator('.entry-heading').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('name'),'Pixie');
    await page.locator('#detail-back').click(); await ready(page);
    assert.equal(await page.locator('#demon-filter').inputValue(),'Pixie');
    assert.equal(await page.locator('[data-race-category="Fairy"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-reset-catalog="demons"]').click();
    await page.locator('#demon-method').selectOption('dlc');
    assert.deepEqual(await page.locator('.demon-record').evaluateAll(cards => cards.map(card => card.dataset.demonName).sort()),['Dagda','Konohana Sakuya']);
    await fillSearch(page,'demon-filter','no-such-demon-collection-fixture');
    assert.equal(await page.locator('#tab-demons .collection-empty').isVisible(),true);
    await page.locator('[data-reset-catalog="demons"]').click();
    assert.equal(await page.locator('.demon-record').count(),totals.demons);
    await fillSearch(page,'demon-filter','Pixie');
    await page.locator('[data-demon-name="Pixie"] [data-plan]').click();
    assert.equal(await page.locator('#tab-planner').isVisible(),true);
    assert.equal(await page.evaluate(() => state.target),'Pixie');
    checks.push('complete demon collection, combined filters, empty/reset, keyboard preview, detail return, saved filters and configure action');

    await tab(page,'skills');
    assert.equal(await page.locator('.skill-record').first().getAttribute('data-affinity'),'phy');
    await skillOrder(page);
    await fillSearch(page,'skill-filter','物理');
    await page.locator('#skill-inherit').selectOption('normal');
    assert((await skillOrder(page)).length > 1,'combined search and inheritance filters retain multiple ordered attributes');
    await page.locator('[data-reset-catalog="skills"]').click();
    await skillOrder(page);
    checks.push('skill attribute order matches the sidebar before filtering, after combined filters, and after reset');
    const fire = page.locator('[data-skill-category="fir"]');
    await fire.locator('[data-element-icon]').click();
    assert.equal(await fire.getAttribute('aria-pressed'),'true','the category icon is clickable');
    await page.locator('#skill-inherit').selectOption('normal');
    await fillSearch(page,'skill-filter','Agilao');
    const agilao = page.locator('[data-skill-name="Agilao"]');
    await preview(page,agilao);
    assert.equal(await agilao.locator('.skill-record-link [data-element-icon="fir"]').count(),1);
    await agilao.locator('.skill-record-link').click();
    await page.locator('.entry-heading').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('name'),'Agilao');
    await page.locator('#detail-back').click(); await ready(page);
    assert.equal(await page.locator('#skill-filter').inputValue(),'Agilao');
    assert.equal(await page.locator('#skill-inherit').inputValue(),'normal');
    assert.equal(await page.locator('[data-skill-category="fir"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-reset-catalog="skills"]').click();
    assert.equal(await page.locator('.skill-record').count(),totals.skills);
    checks.push('skill category icons, inheritance/search filters, exact skill icons, preview and filter-preserving detail links');

    await tab(page,'essences');
    await page.locator('[data-essence-category="aogami"]').click();
    assert.equal(await page.locator('.essence-record').count(),15);
    await fillSearch(page,'essence-filter','Murakumo');
    assert.equal(await page.locator('[data-essence-name="Aogami Type-0"]').count(),1);
    assert.equal(await page.locator('[data-essence-name="Aogami Type-0"] .essence-record-skills a[href*="Murakumo"]').count(),1,'a searched skill is surfaced in the card');
    await page.locator('[data-reset-catalog="essences"]').click();
    const full = await page.evaluate(async () => (await GameSite.catalog).essences.find(e => e.skills.length > 7));
    assert(full,'fixture has an essence with more than seven skills');
    await fillSearch(page,'essence-filter',full.name);
    const essence = page.locator('[data-essence-name='+JSON.stringify(full.name)+']');
    await essence.locator('[data-catalog-preview]').click();
    assert.equal(await page.locator('#catalog-preview .inspector-skills li').count(),full.skills.length,'preview exposes every skill');
    await page.locator('[data-close-preview]').click();
    assert.equal(await essence.locator('[data-catalog-preview]').evaluate(e => document.activeElement === e),true);
    await page.locator('[data-reset-catalog="essences"]').click();
    await page.locator('#essence-element').selectOption('phy');
    const filtered = await page.locator('.essence-record').count();
    await page.reload(); await ready(page);
    assert.equal(await page.locator('#essence-element').inputValue(),'phy');
    assert.equal(await page.locator('.essence-record').count(),filtered);
    await page.locator('[data-reset-catalog="essences"]').click();
    assert.equal(await page.locator('.essence-record').count(),totals.essences);
    checks.push('all fifteen Aogami forms, skill search prioritization, full essence preview and persisted attribute filter');

    await page.setViewportSize({width:390,height:1000});
    for (const kind of Object.keys(types)) {
      await tab(page,kind);
      const index = page.locator('#tab-'+kind+' .catalog-index');
      const trigger = index.locator('.catalog-category-toggle');
      assert.equal(await trigger.getAttribute('aria-expanded'),'false','mobile index starts collapsed');
      await trigger.focus(); await page.keyboard.press('Enter');
      assert.equal(await trigger.getAttribute('aria-expanded'),'true');
      await page.keyboard.press('Enter');
      assert.equal(await trigger.getAttribute('aria-expanded'),'false');
      await preview(page,page.locator(types[kind]).first());
    }
    checks.push('mobile category indexes toggle with keyboard; modal focus returns without moving the collection');

    for (const language of ['zh-Hans','en','ja','zh-Hant','ko']) {
      await page.goto(base+'/?tab=demons&lang='+language); await ready(page);
      for (const kind of Object.keys(types)) {
        await tab(page,kind); await page.locator('[data-reset-catalog="'+kind+'"]').click();
        if (kind === 'skills') await skillOrder(page);
      }
      for (const skin of ['smtv','p5','p3r']) {
        await displaySettings(page);await page.locator('[data-skin-choice="'+skin+'"]').click();
        for (const mode of ['light','dark']) {
          if (await page.locator('html').getAttribute('data-theme') !== mode) {await displaySettings(page);await page.locator('#site-theme').click();}
          for (const width of [1440,390]) {
            await page.setViewportSize({width,height:1000});
            for (const kind of Object.keys(types)) {
              await tab(page,kind); await layout(page,[language,skin,mode,width,kind].join('/'));
              assert.equal(await page.locator(types[kind]).first().evaluate(e => getComputedStyle(e).animationName),'none','reduced motion disables record arrival');
            }
          }
        }
      }
      await page.setViewportSize({width:320,height:1000});
      await displaySettings(page);await page.locator('#site-font').click();
      for (const kind of Object.keys(types)) {await tab(page,kind); await layout(page,language+'/320/large/'+kind);}
      await displaySettings(page);await page.locator('#site-font').click();
    }
    checks.push('five languages × three themes × two modes × desktop/mobile collections, plus 320px large type and reduced motion');

    const fallbackContext = await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'});
    await useStaticFixture(fallbackContext,base);
    const fallback = await fallbackContext.newPage();
    fallback.on('pageerror',error => errors.push(error.message));
    await fallback.route('**/assets/demons/**',route => route.abort());
    await fallback.goto(base+'/?tab=demons&lang=en'); await ready(fallback);
    await fillSearch(fallback,'demon-filter','Pixie');
    await preview(fallback,fallback.locator('[data-demon-name="Pixie"]'));
    await fallback.locator('[data-demon-name="Pixie"] [data-plan]').click();
    assert.equal(await fallback.evaluate(() => state.target),'Pixie','missing optional portraits cannot break configure');
    await fallbackContext.close();
    checks.push('missing optional portraits retain searchable names, preview and configuration');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks}));
  } catch (error) {
    if (page) await page.screenshot({path:path.join(__dirname,'collections-failure.png')}).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
