const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const traits = require('../data/demon-traits.json');
const profiles = require('../data/demon-profiles.json');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const artifact = name => __dirname + '/demon-traits-' + name + '.png';

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
}
async function layout(page) {
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => ({
    overflow:document.documentElement.scrollWidth > innerWidth,
    clipped:[...document.querySelectorAll('.affinity-grid > div,.ailment-grid > div,#elements button,.entry-traits h2')].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 2).map(e=>e.className || e.textContent)
  }));
  assert.deepEqual(state,{overflow:false,clipped:[]});
}
async function snapshot(page, selector, name) {
  await page.locator(selector).evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
  await page.evaluate(() => document.fonts.ready);
  await page.locator(selector).screenshot({path:artifact(name)});
}

(async () => {
  const browser=await chromium.launch({args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  const errors=[],missing=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)missing.push(r.status()+' '+r.url());});
  try {
    await page.goto(base+'/?tab=planner&target=Erthys'); await ready(page);
    await page.locator('.slot-empty').first().click();
    await page.locator('#skill-dialog').waitFor({state:'visible'});
    const keys=await page.locator('#elements button[data-element]').evaluateAll(buttons=>buttons.map(b=>b.dataset.element).filter(Boolean));
    for(const key of keys) {
      const button=page.locator(`#elements button[data-element="${key}"]`);
      await button.locator('img').click();
      assert.equal(await button.getAttribute('aria-pressed'),'true','clicking the icon must select '+key);
      const incorrect=await page.locator('.skill-option').evaluateAll((buttons,element)=>buttons.map(b=>b.dataset.add).filter(name=>GameSite.skillUI.skills.get(name).element!==element),key);
      assert.deepEqual(incorrect,[]);
    }
    const fire=page.locator('#elements [data-element="fir"]');
    await fire.focus(); await page.keyboard.press('Space');
    assert.equal(await fire.getAttribute('aria-pressed'),'true');
    assert.equal(await fire.evaluate(e=>e===document.activeElement),true,'selection preserves keyboard focus');
    await page.locator('#elements [data-element="ice"]').click({position:{x:5,y:5}});
    assert.equal(await page.locator('#elements [data-element="ice"]').getAttribute('aria-pressed'),'true');
    await page.locator('#elements [data-element=""]').click();
    assert.equal(await page.locator('#elements [aria-pressed="true"]').getAttribute('data-element'),'');
    await layout(page); await snapshot(page,'#elements','filter');
    console.log('PASS: every category icon is clickable; padding, All and keyboard selection work and preserve focus');

    const labels={'-':'普通',w:'弱',s:'耐',n:'无效'};
    for(const name of ['Erthys','Alice','Pixie','Nuwa','Abaddon']) {
      await page.goto(base+'/demon.html?name='+encodeURIComponent(name));
      await page.locator('.affinity-grid').waitFor();
      assert.equal(await page.locator('[data-affinity]').count(),11);
      assert.equal(await page.locator('[data-ailment]').count(),6);
      for(const [index,key] of traits.affinityOrder.entries()) {
        const value=traits.demons[name].affinities[index];
        assert.equal(await page.locator(`[data-affinity="${key}"] b`).innerText(),(value>0?'+':'')+value);
      }
      for(const [index,key] of traits.ailmentOrder.entries()) {
        assert.equal(await page.locator(`[data-ailment="${key}"] b`).innerText(),labels[traits.demons[name].ailments[index]]);
        const icon=page.locator(`[data-ailment-icon="${key}"]`);
        await icon.evaluate(e=>e.complete?Promise.resolve():new Promise(resolve=>e.addEventListener('load',resolve,{once:true})));
        assert.equal(await icon.evaluate(e=>e.naturalWidth),64);
      }
      assert.deepEqual(await page.locator('.demon-profile-copy p').allTextContents(),profiles.demons[name].paragraphs);
      assert.equal(await page.locator('.demon-profile h2').innerText(),'仲魔介绍');
      assert.equal(await page.locator('.demon-profile-source,.demon-profile h2 small').count(),0);
      await layout(page);
      if(name==='Erthys') {
        await snapshot(page,'.entry-traits','erthys');
        await snapshot(page,'.demon-profile','description');
      }
    }
    console.log('PASS: eleven initial potentials, six ailment grades and original icons match native game data; descriptions have no source labels');

    for(const width of [1000,1440,1920]) {
      await page.setViewportSize({width,height:1050});await layout(page);
      await page.locator('#site-font').click();await layout(page);
      await page.locator('#site-theme').click();await layout(page);
      if(width===1000)await snapshot(page,'.entry-traits','dark-large');
      await page.locator('#site-theme').click();await page.locator('#site-font').click();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    console.log('PASS: 1000/1440/1920px, large fonts, both themes and no image or JavaScript failures');
  } catch(error) {
    await page.screenshot({path:artifact('failure')}).catch(()=>{});throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
