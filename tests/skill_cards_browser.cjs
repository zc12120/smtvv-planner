const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const artifact = name => __dirname + '/skill-cards-' + name + '.png';
const build = ['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul'];

async function solved(page) {
  await page.waitForFunction(() => window.currentPage?.finished || document.querySelector('#error')?.textContent, {}, {timeout:30000});
  assert.equal(await page.locator('#error').innerText(),'');
  assert.equal(await page.evaluate(() => currentPage.complete),true);
}
async function configure(page, target, skills, objective) {
  await page.goto(base + '/#config=' + encodeURIComponent(JSON.stringify({target,skills})));
  await page.locator('[data-planner-view="build"]').click();
  await page.locator('#calculate').click();
  await solved(page);
  await page.locator('[data-planner-view="route"]').click();
  await page.locator(`.strategy[data-optimal="${objective}"]`).click();
}
async function names(card) {
  return card.locator('.entity-skill-list li > a').evaluateAll(links => links.map(link => new URL(link.href).searchParams.get('name')));
}
async function snapshot(page, locator, name) {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].filter(image => image.loading !== 'lazy').every(image => image.complete && image.naturalWidth));
  await locator.screenshot({path:artifact(name)});
}
async function layout(page) {
  const problems = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('.recipe-entity,.entity-skills,.entity-skill-list a,.entity-kicker')];
    return {
      overflow:document.documentElement.scrollWidth > innerWidth,
      clipped:elements.filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2).map(element => element.className + ': ' + element.textContent),
      misplaced:[...document.querySelectorAll('.recipe-entity')].filter(card => card.querySelector('.entity-skills').getBoundingClientRect().top < card.querySelector(':scope > strong').getBoundingClientRect().bottom).length
    };
  });
  assert.deepEqual(problems,{overflow:false,clipped:[],misplaced:0});
}

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await page.goto(base + '/demon.html?name=Erthys&from=demons');
    await page.locator('.innate-effect').waitFor();
    assert.match(await page.locator('.innate-effect').innerText(),/低于自身的电击技能适合度/);
    assert.equal(await page.locator('.innate [data-element-icon="innate"]').count(),1);
    await snapshot(page,page.locator('.entry-columns').first(),'demon-innate');
    await page.locator('.innate .skill-link').click();
    await page.locator('.entry-effect').first().waitFor();
    assert.match(await page.locator('h1').innerText(),/电击增幅/);
    assert.match(await page.locator('.entry-source').innerText(),/磐石精灵/);
    assert.match(await page.locator('.entry-source').innerText(),/托尔/);
    assert.equal(await page.locator('a[href*="addSkill="]').count(),0);
    assert.match(await page.locator('.entry-note').innerText(),/非官方/);
    await page.reload();
    await page.locator('.entry-effect').first().waitFor();
    await snapshot(page,page.locator('#entry-content'),'innate-detail');
    await page.locator('#detail-back').click();
    await page.locator('.innate-effect').waitFor();
    assert.match(await page.locator('h1').innerText(),/磐石精灵/);
    console.log('PASS: innate description, icon, detail link, shared holders, reload and return; no inheritance action');

    const requested=['Megidolaon','Enduring Soul','Figment Slash'];
    await configure(page,'Melchizedek',requested,'shortest');
    const final=page.locator('#route-step-3');
    assert.deepEqual(await names(final.locator('[data-carrier-id="m1"]')),[]);
    assert.deepEqual(await names(final.locator('[data-carrier-id="s2"]')),requested);
    assert.deepEqual(await names(final.locator('.recipe-result')),requested);
    assert.equal(await final.locator('.recipe-result .entity-skill-meta [data-origin="s2"]').count(),3);
    await snapshot(page,final,'melchizedek');
    await final.locator('.recipe-result .entity-skill-meta [data-origin="s2"]').first().click();
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-2');
    assert.match(await page.locator('#route-step-2 .recipe-result [data-skill="Enduring Soul"]').innerText(),/Lv\.89 习得/);
    console.log('PASS: screenshot case assigns all three inherited skills to Vishnu, preserves result skills and source jumps');

    await configure(page,'Yoshitsune',build,'mixed');
    const essence=page.locator('#route-step-2');
    assert.deepEqual(await names(essence.locator('.recipe-inputs [data-carrier-id="s1"]')),['Abyssal Mask','Safeguard']);
    assert.deepEqual(await names(essence.locator('.essence-entity')),['High Phys Pleroma']);
    assert.deepEqual(await names(essence.locator('.recipe-result')),['Abyssal Mask','Safeguard','High Phys Pleroma']);
    assert.equal(await essence.locator('.recipe-result .skill-method.retained').count(),2);
    assert.equal(await essence.locator('.recipe-result .skill-method.essence').count(),1);
    await snapshot(page,essence,'essence-retained');
    assert.deepEqual((await names(page.locator('#route-step-4 .recipe-result'))).sort(),[...build].sort());
    assert.match(await page.locator('#route-step-4 .recipe-result [data-skill="Hassou Tobi"]').innerText(),/初始自带/);
    await page.locator('[data-planner-view="build"]').click();
    assert.match(await page.locator('#target-card .innate-effect').innerText(),/行动图标/);
    assert.equal(await page.locator('#target-card .innate .skill-link').count(),1);
    console.log('PASS: essence cards keep existing and newly granted skills; final eight skills include native Hassou Tobi');

    await configure(page,'Arioch',['Figment Slash','Phys Pleroma','High Phys Pleroma'],'mixed');
    const special=page.locator('#route-step-3');
    assert.equal(await special.locator('.recipe-inputs .recipe-entity').count(),3);
    assert.deepEqual(await names(special.locator('[data-carrier-id="s1"]')),['Figment Slash','Phys Pleroma']);
    assert.deepEqual(await names(special.locator('[data-carrier-id="m3"]')),[]);
    assert.deepEqual(await names(special.locator('[data-carrier-id="s2"]')),['High Phys Pleroma']);
    for (const width of [1000,1440]) {
      await page.setViewportSize({width,height:1050});
      await layout(page);
      await page.locator('#site-font').click();
      await layout(page);
      await page.locator('#site-theme').click();
      await layout(page);
      await snapshot(page,special,'special-' + width + '-dark-large');
      await page.locator('#site-theme').click();
      await page.locator('#site-font').click();
    }
    await snapshot(page,special,'special');
    assert.deepEqual(errors,[]);
    console.log('PASS: three-material fusion correspondence and 1000/1440px layouts, large text and dark theme');
  } catch(error) {
    await page.screenshot({path:artifact('failure')}).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
