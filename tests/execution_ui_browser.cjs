const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {useStaticFixture} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const config = {target:'Arioch', skills:['Figment Slash','Phys Pleroma','High Phys Pleroma']};
const artifact = name => __dirname + '/' + (process.env.SMTVV_ARTIFACT_PREFIX || 'persona') + '-' + name + '.png';
const objectiveOrder = ['mixed','shortest','cheapest'];

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
}
async function solved(page) {
  await page.waitForFunction(() => window.currentPage?.finished || document.querySelector('#error')?.textContent, {}, {timeout:30000});
  const result = await page.evaluate(() => ({complete:currentPage?.complete,error:document.querySelector('#error').textContent}));
  assert.equal(result.complete,true,JSON.stringify(result));
}
async function generate(page) {
  await ready(page);
  await page.locator('[data-planner-view="build"]').click();
  await page.locator('#calculate').click();
  await solved(page);
  await page.locator('[data-planner-view="build"]').click();
}
async function chooseRoute(page, objective) {
  await page.locator(`.strategy[data-optimal="${objective}"]`).click();
  await solved(page);
  assert.equal(await page.locator('#route-choices').getAttribute('open'),null);
}
function currentDirectoryItemVisible() {
  const list=document.querySelector('.step-nav-list');
  const item=list?.querySelector('[aria-current="step"]');
  if(!item) return false;
  const view=list.getBoundingClientRect(),selected=item.getBoundingClientRect();
  return selected.left>=view.left-1 && selected.right<=view.right+1;
}
async function layout(page) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForFunction(() => [...document.images].filter(image => {
    const box=image.getBoundingClientRect();
    return image.loading!=='lazy' || (image.getClientRects().length && box.bottom>0 && box.top<innerHeight);
  }).every(image=>image.complete));
  const result = await page.evaluate(() => ({
    overflow:document.documentElement.scrollWidth > innerWidth,
    clipped:[...document.querySelectorAll('button,h1,h2,.slot-head,.ledger-node')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2).map(element => element.id || element.className || element.textContent),
    missingImages:[...document.images].filter(image => {
      const box=image.getBoundingClientRect();
      return image.loading!=='lazy' || (image.getClientRects().length && box.bottom>0 && box.top<innerHeight);
    }).filter(image => !image.complete || !image.naturalWidth).map(image => image.src)
  }));
  assert.equal(result.overflow,false,'no horizontal page overflow');
  assert.deepEqual(result.clipped,[],'no clipped controls or headings');
  assert.deepEqual(result.missingImages,[],'every eager image and visible lazy portrait must load');
}
async function skillIcons(page) {
  const bad = await page.evaluate(() => [...document.querySelectorAll('a[href*="/skill.html?name="]')].filter(link => {
    const name = new URL(link.href).searchParams.get('name');
    const skill = GameSite.skillUI.skills.get(name);
    return !link.querySelector(`[data-element-icon="${skill?.element}"]`);
  }).map(link => link.href));
  assert.deepEqual(bad,[],'all skill links use their own category icon');
}

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  let page;
  const errors=[],missing=[],pending=new Set();
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('request',request=>pending.add(request));
    page.on('requestfinished',request=>pending.delete(request));
    page.on('requestfailed',request=>pending.delete(request));
    page.on('pageerror',error=>errors.push(error.stack));
    page.on('response',response=>{if(response.status()>=400 && !response.url().includes('not-a-skill'))missing.push(response.status()+' '+response.url());});
    await page.goto(base + '/#config=' + encodeURIComponent(JSON.stringify(config)));
    await generate(page); await layout(page); await skillIcons(page);
    assert.deepEqual(await page.locator('[data-preview]').evaluateAll(items=>items.map(item=>item.dataset.preview)),['mixed']);
    assert.equal(await page.locator('.native-skill-row .skill-symbol').count(),7);
    await page.screenshot({path:artifact('build')});
    await page.locator('#calculate').click();
    await layout(page);
    const fonts = await page.evaluate(() => ({
      body:document.fonts.check('18px "Vengeance Sans"'),
      latin:document.fonts.check('17px "Interface Barlow"'),
      display:document.fonts.check('700 40px "Archive Serif SC"'),
      family:getComputedStyle(document.documentElement).fontFamily,
      heading:getComputedStyle(document.querySelector('h1')).fontFamily
    }));
    assert(fonts.body && fonts.latin && fonts.display && fonts.family.includes('Interface Barlow') && fonts.heading.includes('Archive Serif SC'),'local reading and SMT V display fonts load and are applied');
    assert(await page.locator('#planner-build').isHidden());
    assert.equal(await page.locator('.step-nav-item').count(),3);
    assert.equal(await page.locator('.operation-step').count(),3);
    assert.equal(await page.locator('[data-step-mode], [data-complete-next]').count(),0,'single-step controls are removed');
    assert.deepEqual(await page.locator('.strategy').evaluateAll(items=>items.map(item=>item.dataset.optimal)),objectiveOrder);
    assert.equal(await page.locator('.strategy.selected').getAttribute('data-optimal'),'mixed');
    for (const [key,objective] of [['ArrowRight','shortest'],['End','cheapest'],['Home','mixed'],['ArrowLeft','cheapest'],['ArrowRight','mixed']]) {
      await page.locator('.strategy.selected').focus();
      await page.keyboard.press(key);
      await solved(page);
      assert.equal(await page.locator('.strategy.selected').getAttribute('data-optimal'),objective);
      assert(await page.locator('.strategy.selected').evaluate(node=>node===document.activeElement),'strategy switching keeps keyboard focus');
    }
    assert.equal(await page.locator('[data-complete],.step-check,.guide-progress,footer,.about').count(),0,'completion controls and bottom descriptions are removed');
    const routeReading = await page.locator('.ledger-final-node').evaluate(node=>({
      avatar:node.querySelector('.demon-portrait').getBoundingClientRect().width,
      font:parseFloat(getComputedStyle(node.querySelector('.skill-link')).fontSize),
      skillColumns:new Set([...node.querySelectorAll('.ledger-skills li')].map(item=>Math.round(item.getBoundingClientRect().left))).size
    }));
    assert(routeReading.avatar>=88 && routeReading.font>=16,'route identity and skill text stay readable');
    assert(routeReading.skillColumns>1,'desktop result skills use the available horizontal space');
    await page.screenshot({path:artifact('route')});
    await page.locator('#route-choices > summary').click();
    assert.equal(await page.locator('.route-comparison tbody tr').count(),3);
    assert.deepEqual(await page.locator('.route-comparison [data-optimal]').evaluateAll(items=>items.map(item=>item.dataset.optimal)),objectiveOrder);
    for(const objective of objectiveOrder) {
      const expected=await page.evaluate(key=>currentPage.solutions[key].totalCost,objective);
      assert.equal(await page.locator(`[data-optimal="${objective}"] td`).first().innerText(),expected.toLocaleString('zh-CN'));
    }
    await page.locator('#route-choices').screenshot({path:artifact('comparison')});
    await page.locator('.route-comparison [data-optimal="mixed"] button').click();
    assert.equal(await page.locator('#route-choices').getAttribute('open'),null);
    await page.locator('[data-select-step="1"]').click();
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-2');
    assert.equal(await page.locator('.operation-step').count(),3);
    assert.equal(await page.locator('#route-step-2 [data-role="essence"] .ledger-skills [data-element-icon="pas"]').count(),1);
    await page.locator('#route-step-2 [data-role="essence"] .ledger-person strong a').click();
    await page.waitForSelector('.entry-heading'); await skillIcons(page);
    assert.match(await page.locator('h1').innerText(),/蚩尤/);
    await page.locator('#detail-back').click(); await solved(page);
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-2');
    assert.equal(await page.locator('.operation-step').count(),3);
    const savedBuild=await page.evaluate(()=>configKey());
    const savedRoutes=await page.evaluate(()=>JSON.stringify(currentPage));
    const unexpectedNavigation=[];
    const trackNavigation=request=>{if(request.isNavigationRequest()||request.url().includes('/api/optimal/start'))unexpectedNavigation.push(request.url());};
    page.on('request',trackNavigation);
    for(const tab of ['planner','demons','skills','essences']) {
      if(tab!=='planner')await page.locator(`[data-tab="${tab}"]`).click();
      await page.locator('.site-brand').click();
      await page.waitForFunction(()=>activeTab==='planner'&&plannerView==='build'&&scrollY===0);
      assert.equal(await page.evaluate(()=>configKey()),savedBuild,'logo preserves the configured demon and skills');
      assert.equal(await page.evaluate(()=>JSON.stringify(currentPage)),savedRoutes,'logo preserves computed routes');
      assert(await page.locator('#planner-build').isVisible());
      await page.locator('#route-tab').click();
    }
    page.off('request',trackNavigation);
    assert.deepEqual(unexpectedNavigation,[],'logo returns to configuration without reloading or recomputing');
    for(const entry of ['demon','skill','essence']) {
      await page.locator(`.ledger-step a[href*="/${entry}.html?name="]`).first().click();
      await page.waitForSelector('.entry-heading');
      await page.locator('.site-brand').focus();await page.keyboard.press('Enter');await solved(page);
      assert(await page.locator('#planner-build').isVisible(),'detail logo returns to configuration');
      assert.equal(await page.evaluate(()=>configKey()),savedBuild);
      assert.equal(await page.evaluate(()=>JSON.stringify(currentPage)),savedRoutes);
      await page.locator('#route-tab').click();await page.reload();await solved(page);
      assert(await page.locator('#planner-route').isVisible(),'later reloads still restore the chosen route view');
    }
    await page.evaluate(() => {
      const saved=JSON.parse(localStorage.getItem('smtvv-route-progress'));
      for(const entry of Object.values(saved)) { entry.mode='focus'; entry.done=[0]; }
      localStorage.setItem('smtvv-route-progress',JSON.stringify(saved));
    });
    await page.reload(); await solved(page);
    assert.equal(await page.locator('.operation-step').count(),3,'old saved focus mode cannot hide steps');
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-2');
    await page.locator('[data-select-step="2"]').click();
    await page.locator('#route-step-3 [data-origin="s1"]').first().click();
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-1');
    assert.equal(await page.locator('.operation-step').count(),3,'source jumps preserve the entire checklist');
    await page.locator('#route-step-1 [data-origin="m1"]').first().click();
    assert(await page.locator('.materials-table').isVisible());
    assert(await page.locator('#material-m1').isVisible());
    await skillIcons(page);
    await page.locator('[data-guide-panel="steps"]').click();
    assert.equal(await page.locator('.operation-step').count(),3);
    await skillIcons(page);
    await chooseRoute(page,'cheapest');
    assert.equal(await page.locator('.step-nav-item').count(),59);
    assert.equal(await page.locator('.operation-step').count(),59,'long routes show every step immediately');
    await page.locator('#jump-step').fill('59'); await page.locator('#jump-step').press('Enter');
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-59');
    assert.equal(await page.locator('.operation-step').count(),59);
    await page.locator('.step-nav-item').nth(58).click();
    const lastStepBox=await page.locator('#route-step-59').boundingBox();
    assert(lastStepBox.y>=48 && lastStepBox.y<850,'last step heading is visible after directory navigation');
    await page.setViewportSize({width:390,height:844});
    for(const number of [1,59]) {
      await page.locator('#jump-step').fill(String(number));
      await page.locator('#jump-step').press('Enter');
      await page.waitForFunction(currentDirectoryItemVisible);
      assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-'+number);
    }
    await page.reload(); await solved(page);
    await page.waitForFunction(currentDirectoryItemVisible);
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-59');
    await layout(page);
    await page.setViewportSize({width:1440,height:1000});
    await chooseRoute(page,'mixed');
    await page.locator('[data-select-step="1"]').click();
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-2');
    assert.equal(await page.locator('.operation-step').count(),3);
    await skillIcons(page);
    await page.locator('[data-guide-panel="skills"]').click();
    assert(await page.locator('.final-skills-table').isVisible());
    const download=page.waitForEvent('download'); await page.locator('#export-text').click();
    const exported=await download;
    assert(exported.suggestedFilename().endsWith('合体路线.txt'));
    const exportedText=await fs.readFile(await exported.path(),'utf8');
    for(const number of [1,2,3]) assert(exportedText.includes(number+'. '),'all selected route steps are exported');
    console.log('PASS: all 59 steps, mobile directory follows jumps and restored position, objective order, legacy migration, source jumps, final skills, details return and export');

    await page.locator('[data-planner-view="build"]').click();
    await page.locator('[data-choose-source="Figment Slash"]').click();
    await page.locator('#source-search').fill('Kali');
    await page.locator('[data-set-source="Kali"]').click(); await generate(page);
    assert.equal(await page.evaluate(()=>state.sources['Figment Slash']),'Kali');
    await page.locator('[data-replace="0"]').click();
    await page.locator('#skill-search').fill('Enduring Soul');
    assert.equal(await page.locator('[data-add="Enduring Soul"] [data-element-icon="pas"]').count(),1);
    await page.locator('#skill-dialog').screenshot({path:artifact('skill-picker')});
    await page.locator('[data-add="Enduring Soul"]').click(); await generate(page);
    assert.equal(await page.evaluate(()=>state.sources['Figment Slash']),undefined);
    await page.locator('[data-tab="skills"]').click();
    await page.locator('[aria-controls="skill-categories"]').click();
    await page.locator('[data-skill-category="fir"]').click();
    await page.locator('#skill-filter').fill('Agilao');
    await skillIcons(page);
    await page.locator('.skill-record-link').first().click();
    await page.waitForSelector('.entry-heading');
    assert.equal(await page.locator('h1 [data-element-icon="fir"]').count(),1);
    await page.screenshot({path:artifact('skill-detail')});
    await page.locator('#detail-back').click(); await ready(page);
    assert.equal(await page.locator('#skill-filter').inputValue(),'Agilao');
    await page.locator('#global-search').fill('爱丽丝');
    await page.locator('#global-search').press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForSelector('.entry-heading'); await skillIcons(page);
    assert.equal(await page.locator('.entry-main .innate [data-element-icon="innate"]').count(),1);
    await page.locator('.entry-heading .primary').click(); await generate(page);
    assert.equal(await page.evaluate(()=>state.target),'Alice');
    console.log('PASS: skill replacement, source choice, native skills, global search and linked catalogs');

    for(const width of [1000,1100,1280,1440,1920]) {
      await page.setViewportSize({width,height:1000}); await layout(page);
      await page.locator('#site-font').click(); await layout(page);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'20px');
      await page.locator('[data-planner-view="route"]').click(); await layout(page);
      await page.locator('#site-font').click(); await layout(page);
      await page.locator('[data-planner-view="build"]').click();
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#site-theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.locator('#site-theme').click(); await page.mouse.move(700,160);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.screenshot({path:artifact('light-build')});
    await page.locator('[data-planner-view="route"]').click(); await layout(page);
    await page.screenshot({path:artifact('light-route')});
    await page.locator('[data-tab="essences"]').click();
    await page.locator('#essence-filter').fill('Murakumo'); await skillIcons(page);
    await page.locator('.essence-record a[href*="essence.html"]').first().click();
    await page.waitForSelector('.entry-skill-row'); await skillIcons(page);
    assert.match(await page.locator('#entry-content').innerText(),/创毘专用/);
    await page.goto(base+'/?tab=planner'); await solved(page);
    await page.locator('[data-planner-view="build"]').click();
    await page.locator('#settings summary').click();
    await page.locator('#level').fill('1'); await page.locator('#level').dispatchEvent('change');
    await page.locator('#calculate').click();
    await page.waitForFunction(()=>document.querySelector('#error').textContent.length>0);
    await page.locator('[data-planner-view="route"]').click();
    assert(await page.locator('#generation-notice').isVisible());
    await page.locator('[data-planner-view="build"]').click();
    await page.locator('#level').fill('150'); await page.locator('#level').dispatchEvent('change');
    await generate(page); assert(await page.locator('#generation-notice').isHidden());
    await page.goto(base+'/skill.html?name=not-a-skill');
    await page.waitForSelector('.error');
    assert.deepEqual(errors,[]);
    assert.deepEqual(missing,['400 '+base+'/api/optimal/start'],'only the deliberately invalid level request should fail');
    console.log('PASS: 1000/1100/1280/1440/1920 desktop widths, local fonts, large fonts, light/dark themes, protagonist essence icons and error state');
  } catch(error) {
    if(page) {
      const state=await page.evaluate(()=>({url:location.href,title:document.title,ready:document.readyState,status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,gameSite:typeof GameSite,currentPage:typeof currentPage})).catch(()=>null);
      console.error('BROWSER_FAILURE',JSON.stringify({state,errors,missing,pending:[...pending].map(request=>request.url())}));
      await page.screenshot({path:artifact('failure')}).catch(()=>{});
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
