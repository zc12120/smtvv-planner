const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const {useStaticFixture} = require('./browser_env.cjs');
const profiles = require('../data/demon-profiles.json');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const artifact = name => __dirname + '/official-profiles-' + name + '.png';

async function checkProfile(page, name, selector='.demon-profile-full') {
  await page.locator(selector).waitFor();
  assert.deepEqual(await page.locator(selector + ' .demon-profile-copy p').allTextContents(),profiles.demons[name].paragraphs);
  assert.equal(await page.locator(selector + ' .demon-profile-source, ' + selector + ' h2 small').count(),0);
  assert.equal(await page.locator(selector).getAttribute('data-profile-for'),name);
}
async function layout(page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => ({
    overflow:document.documentElement.scrollWidth > innerWidth,
    clipped:[...document.querySelectorAll('.demon-profile,.demon-profile-copy,summary')].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 2).map(e => e.className)
  }));
  assert.deepEqual(result,{overflow:false,clipped:[]});
}
async function screenshot(page, selector, name) {
  const viewport=page.viewportSize();
  const box=await page.locator(selector).boundingBox();
  const height=Math.max(viewport.height,Math.ceil(box.height)+320);
  if(height!==viewport.height) await page.setViewportSize({...viewport,height});
  await page.locator(selector).evaluate(element => element.scrollIntoView({block:'center',behavior:'instant'}));
  await page.evaluate(() => document.fonts.ready);
  await page.locator(selector).screenshot({path:artifact(name)});
  if(height!==viewport.height) await page.setViewportSize(viewport);
}

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  await useStaticFixture(context,base);
  const page = await context.newPage();
  const errors=[],badResponses=[];
  page.on('pageerror',error => errors.push(error.message));
  page.on('response',response => { if(response.status() >= 400) badResponses.push(response.status() + ' ' + response.url()); });
  try {
    for (const name of ['Pixie','Alice','Nuwa','Nuwa A','Abdiel','Abdiel A','Lilith','Dagda','Konohana Sakuya']) {
      await page.goto(base + '/demon.html?name=' + encodeURIComponent(name));
      await checkProfile(page,name);
      await layout(page);
      assert.equal(await page.locator('.innate .skill-link').count(),1);
      if(name === 'Pixie') await screenshot(page,'#entry-content','pixie-detail');
    }
    await screenshot(page,'.demon-profile-full','long-profile');
    await page.reload(); await checkProfile(page,'Konohana Sakuya');
    for(const width of [1000,1440,1920]) {
      await page.setViewportSize({width,height:1050});
      await layout(page);
      await page.locator('#site-font').click(); await layout(page);
      await page.locator('#site-theme').click(); await layout(page);
      if(width===1000) await screenshot(page,'.demon-profile-full','dark-large');
      await page.locator('#site-theme').click(); await page.locator('#site-font').click();
    }
    console.log('PASS: official paragraphs on nine representative detail pages, distinct forms, DLC, reload and 1000/1440/1920px dark/large layouts');

    await page.setViewportSize({width:1440,height:1050});
    await page.goto(base + '/?tab=planner&target=Pixie');
    await page.locator('#target-card .demon-profile-collapsible').waitFor();
    assert.equal(await page.locator('.demon-profile-collapsible').getAttribute('open'),null);
    await page.locator('.demon-profile-collapsible summary').focus();
    await page.keyboard.press('Enter');
    await checkProfile(page,'Pixie','.demon-profile-collapsible');
    await layout(page);
    await screenshot(page,'.demon-profile-collapsible','target-expanded');
    await page.locator('.demon-profile-collapsible summary').click();
    assert.equal(await page.locator('.demon-profile-collapsible').getAttribute('open'),null);
    await page.locator('#target-card .target-head h3 a').click();
    await checkProfile(page,'Pixie');
    await page.locator('.innate .skill-link').click();
    await page.locator('.entry-effect').first().waitFor();
    await page.locator('#detail-back').click(); await checkProfile(page,'Pixie');
    console.log('PASS: collapsed target introduction, keyboard expansion, original paragraphs, detail and innate return');

    await page.goto(base + '/?tab=demons');
    await page.locator('[data-demon-name="Pixie"]').waitFor();
    await page.locator('[data-demon-name="Pixie"] [data-catalog-preview]').first().click();
    await page.locator('.demon-profile-preview').waitFor();
    assert.equal(await page.locator('.demon-profile-preview .demon-profile-copy').innerText(),profiles.demons.Pixie.paragraphs[0]);
    await layout(page);
    await screenshot(page,'#catalog-preview[open]','compendium-preview');
    await page.locator('#catalog-preview[open] .inspector-link').click();
    await checkProfile(page,'Pixie');
    assert.deepEqual(errors,[]);
    assert.deepEqual(badResponses,[]);
    console.log('PASS: compendium preview quotes the first official paragraph and opens the complete profile; no browser or HTTP errors');
  } catch(error) {
    await page.screenshot({path:artifact('failure')}).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
