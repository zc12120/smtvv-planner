const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const {useStaticFixture} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const config = {target:'Alice', skills:['Megidolaon','Almighty Pleroma','High Almighty Pleroma']};
const artifact = name => __dirname + '/' + (process.env.SMTVV_ARTIFACT_PREFIX || 'avatars') + '-' + name + '.png';

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
}
async function solved(page) {
  await page.waitForFunction(() => currentPage?.finished || document.querySelector('#error')?.textContent, {}, {timeout:45000});
  assert.equal(await page.locator('#error').innerText(), '');
  assert.equal(await page.evaluate(() => currentPage.complete), true);
}
async function visibleImages(page) {
  await page.waitForFunction(() => [...document.images].filter(image => {
    const box = image.getBoundingClientRect();
    return image.getClientRects().length && box.bottom > 0 && box.top < innerHeight;
  }).every(image => image.complete && image.naturalWidth > 0));
}
async function layout(page) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await visibleImages(page);
  const result = await page.evaluate(() => ({
    overflow:document.documentElement.scrollWidth > innerWidth,
    clipped:[...document.querySelectorAll('.recipe-entity,.entry-heading,h1,h2,button')]
      .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2)
      .map(element => element.id || element.className),
    mismatched:[...document.querySelectorAll('[data-demon-portrait]')].filter(image => {
      const portrait=GameSite.demonUI.portraits.get(image.dataset.demonPortrait);
      const allowed=[portrait?.src,portrait?.display?.src,...(portrait?.optimized?.variants||[]).map(item=>item.src)];
      const source=image.currentSrc||image.getAttribute('src');
      return !source||!allowed.includes(new URL(source,location.href).pathname);
    })
      .map(image => image.dataset.demonPortrait)
  }));
  assert.equal(result.overflow, false, 'No horizontal page overflow');
  assert.deepEqual(result.clipped, [], 'Names and controls remain readable');
  assert.deepEqual(result.mismatched, [], 'Every portrait uses the verified name mapping');
}
async function chooseMixed(page) {
  await page.locator('.strategy[data-optimal="mixed"]').click();
}

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:1704,height:1080},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    const page = await context.newPage();
    const errors=[], failures=[];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if(response.status() >= 400) failures.push(response.status()+' '+response.url()); });
    await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify(config)));
    await ready(page); await page.locator('#calculate').click(); await solved(page);
    const verifiedManifest=await (await context.request.get(base+'/assets/demons/manifest.json')).json();
    await page.locator('[data-planner-view="build"]').click();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'17px');
    assert.equal(await page.locator('#target-card [data-demon-portrait="Alice"]').count(), 1);
    await page.locator('[data-tab="demons"]').click();
    assert.equal(await page.locator('#demon-table [data-demon-portrait]').count(), 275);
    await page.locator('[data-tab="planner"]').click();
    const aogami = await page.evaluate(async manifest => (await GameSite.catalog).essences
      .filter(essence=>essence.group==='aogami').map(essence=>{
        const portrait=manifest.essences[essence.name];
        return {name:essence.name,officialName:portrait?.officialEnglishName,
          gameId:portrait?.gameId,pictureId:portrait?.pictureId,src:portrait?.display?.src};
      }),verifiedManifest);
    assert.equal(aogami.length,15);
    for(const portrait of aogami) {
      assert.equal(portrait.officialName,portrait.name,'Aogami types match the game character-name table');
      assert.equal(portrait.pictureId,389,'All Aogami types use the game shared portrait');
      assert.equal(portrait.src,'/assets/demons/display/aogami-essence.png');
    }
    assert.equal(new Set(aogami.map(portrait=>portrait.gameId)).size,15);
    await layout(page);
    await page.screenshot({path:artifact('build')});
    await page.locator('#calculate').click(); await chooseMixed(page);
    await layout(page);
    assert.equal(await page.locator('.operation-step').count(),await page.evaluate(()=>currentPage.solutions.mixed.steps.length));
    const cards = await page.locator('.operation-step .recipe-entity').evaluateAll(entities => entities.map(entity => {
      const image=entity.querySelector('img[data-demon-portrait]');
      const name=new URL(entity.querySelector('a').href).searchParams.get('name');
      return {name,image:image?.dataset.demonPortrait,width:image?.naturalWidth,hidden:image?.hidden,
        source:image?.currentSrc};
    }));
    assert(cards.length >= 3);
    for (const card of cards) {
      assert.equal(card.image,card.name,'Route image matches its material, essence or result');
      assert(card.width>0); assert(card.source); assert.equal(card.hidden,false);
    }
    await page.evaluate(()=>window.scrollTo(0,document.querySelector('.route-section-heading').getBoundingClientRect().top+scrollY-80));
    await page.screenshot({path:artifact('route')});
    await page.locator('[data-guide-panel="materials"]').click();
    assert.equal(await page.locator('.materials-table [data-demon-portrait]').count(),await page.locator('.materials-table tbody tr').count());
    await layout(page);
    await page.locator('[data-guide-panel="steps"]').click();
    for (const width of [1100,1440,1920]) {
      await page.setViewportSize({width,height:1080}); await layout(page);
      await page.locator('#site-font').click(); await layout(page);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'20px');
      await page.locator('#site-font').click();
    }
    await page.setViewportSize({width:1440,height:1080});
    await page.locator('#site-theme').click(); await layout(page);
    await page.screenshot({path:artifact('route-dark')});
    await page.locator('#site-theme').click();
    await page.locator('[data-tab="demons"]').click();
    await page.locator('#demon-filter').fill('Lilith');
    await page.locator('[data-demon-name="Lilith"] [data-catalog-preview]').click();
    assert.equal(await page.locator('#catalog-preview [data-demon-portrait="Lilith"]').count(),1);
    await layout(page); await page.screenshot({path:artifact('library')});
    await page.locator('#catalog-preview .inspector-link').click();
    await page.waitForSelector('.entry-heading [data-demon-portrait="Lilith"]');
    await layout(page); await page.screenshot({path:artifact('detail')});
    assert.equal(verifiedManifest.demons.Lilith.pictureId,410);
    await page.goto(base+'/essence.html?name=Jack%20Frost');
    await page.waitForSelector('.entry-heading [data-demon-portrait="Jack Frost"]'); await layout(page);
    await page.goto(base+'/?tab=essences'); await ready(page);
    await page.locator('[data-essence-category="aogami"]').click();
    await page.locator('#essence-filter').fill('');
    assert.equal(await page.locator('.essence-collection [data-demon-portrait]').count(),15);
    const sharedSources=await page.locator('.essence-collection [data-demon-portrait]')
      .evaluateAll(images=>[...new Set(images.map(image=>image.getAttribute('src')))]);
    const sharedPortrait=verifiedManifest.essences['Aogami Type-3'];
    assert.deepEqual(sharedSources,[sharedPortrait.optimized?.variants[0].src||sharedPortrait.display.src]);
    await page.locator('[data-essence-name="Aogami Type-3"] [data-catalog-preview]').first().click();
    await page.waitForSelector('#catalog-preview [data-demon-portrait="Aogami Type-3"]');
    await layout(page); await page.screenshot({path:artifact('aogami-list')});
    await page.locator('#catalog-preview .inspector-link').click();
    await page.waitForSelector('.entry-heading [data-demon-portrait="Aogami Type-3"]');
    assert.match(await page.locator('h1').innerText(),/青神参式/);
    await layout(page); await page.screenshot({path:artifact('aogami-detail')});
    await page.locator('#global-search').fill('青神参式');
    await page.waitForSelector('#global-results [data-demon-portrait="Aogami Type-3"]');
    await layout(page);
    await page.goto(base+'/essence.html?name=Aogami%20Type-0');
    await page.waitForSelector('.entry-heading');
    assert.equal(await page.locator('.entry-heading [data-demon-portrait="Aogami Type-0"]').getAttribute('src'),
      sharedPortrait.optimized?.variants[0].src||sharedPortrait.display.src,'Aogami Type-0 uses the same verified game portrait');
    await layout(page);
    await page.goto(base+'/?tab=planner&target=Dagda'); await ready(page);
    assert.equal(await page.locator('#target-card [data-demon-portrait="Dagda"]').count(),1);
    await page.locator('#target-search').fill('Jack Frost');
    await page.locator('[data-demon="Jack Frost"] [data-demon-portrait]').click();
    assert.equal(await page.locator('#target-card [data-demon-portrait="Jack Frost"]').count(),1);
    await page.locator('#global-search').fill('义经');
    await page.waitForSelector('#global-results [data-demon-portrait="Yoshitsune"]');
    await layout(page);
    assert.deepEqual(errors,[]); assert.deepEqual(failures,[]);
    const fallback = await browser.newContext({viewport:{width:1440,height:1000}});
    await useStaticFixture(fallback,base);
    await fallback.route('**/assets/demons/manifest.json*',route=>route.fulfill({status:404,body:'missing'}));
    const plain = await fallback.newPage(); await plain.goto(base); await ready(plain);
    assert.equal(await plain.locator('#error').innerText(),'','Missing art must not disable the planner');
    assert.equal(await plain.locator('#quick-targets button').count(),4);
    await fallback.close();
    console.log('PASS: 275 demon portraits, all 15 Aogami essences sharing dev389, route/material/essence cards, target selection, global search, catalog preview, details, DLC, light/dark, large fonts, 1100/1440/1920 widths, and missing-art fallback');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
