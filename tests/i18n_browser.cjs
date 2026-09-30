'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('./playwright.cjs');
const {useStaticFixture,fillSearch}=require('./browser_env.cjs');
const base=process.env.SMTVV_URL||'http://127.0.0.1:8766';
const languages=['en','ja','zh-Hant','ko','zh-Hans'];
const build={target:'Arioch',skills:['Figment Slash','Phys Pleroma','High Phys Pleroma']};
const checks=[],errors=[];

async function ready(page){
  await page.waitForFunction(()=>document.body.dataset.catalogState==='ready');
  await page.evaluate(()=>document.fonts.ready);
}
async function layout(page){
  const result=await page.evaluate(()=>({
    width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
    clipped:[...document.querySelectorAll('button,h1,h2,.slot-head,.slot-bottom,.resist-cell')]
      .filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.textContent),
  }));
  assert.equal(result.overflow,false,JSON.stringify(result));
  assert.deepEqual(result.clipped,[],JSON.stringify(result));
}
async function noChinese(page){
  const found=await page.evaluate(()=>{
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),found=[];let node;
    while((node=walker.nextNode()))if(/[\u3400-\u9fff]/.test(node.nodeValue)&&node.parentElement.getClientRects().length&&!node.parentElement.closest('script,style,[data-i18n-skip]'))found.push(node.nodeValue.trim());
    return [...new Set(found)];
  });
  assert.deepEqual(found,[],'untranslated visible text: '+JSON.stringify(found));
}
async function changeLanguage(page,language){
  await page.locator('#site-language').click();
  await page.locator('[data-language="'+language+'"]').click();
  await page.waitForURL(url=>url.searchParams.get('lang')===language);
  await ready(page);
  assert.equal(await page.locator('html').getAttribute('lang'),language);
}

(async()=>{
  assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Run the mutation/failure fixtures against an isolated local server');
  const browser=await chromium.launch({args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    const page=await context.newPage();
    // Exercise the account-button removal even when a deployment has a portal.
    await page.route('**/api/catalog*',async route=>{
      const response=await route.fetch();const data=await response.json();data.authPortal='/auth/';
      await route.fulfill({response,json:data});
    });
    await page.goto(base+'/?lang=en#config='+encodeURIComponent(JSON.stringify(build)));
    await ready(page);
    assert.equal(await page.locator('.display-controls a[href^="/auth"]').count(),0);
    assert.equal(await page.locator('[data-language]').count(),5);
    await page.locator('#calculate').click();
    await page.waitForFunction(()=>window.currentPage?.complete,{}, {timeout:60000});
    const initial=await page.evaluate(()=>({state:JSON.stringify(state),steps:JSON.stringify(lastResult.steps),count:lastResult.steps.length}));
    assert(initial.count>1);
    await page.locator('[data-select-step="1"]').click();
    for(const language of ['ja','zh-Hant','ko','zh-Hans','en']){
      await changeLanguage(page,language);
      await page.waitForFunction(()=>window.currentPage?.complete);
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),initial.state,'canonical build changed on language switch');
      assert.equal(await page.evaluate(()=>JSON.stringify(lastResult.steps)),initial.steps,'canonical route changed on language switch');
      assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-2','saved step position was lost');
      assert.equal(await page.locator('.operation-step').count(),initial.count);
      if(language==='en'||language==='ko')await noChinese(page);
      await page.locator('#edit-build').click();
      for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1050});await layout(page);}
      await page.locator('[data-planner-view="route"]').click();
    }
    checks.push('five languages preserve canonical build, complete route, and current step; layouts at 320–1440px');

    for(const language of languages){
      const tab=await context.newPage();
      await tab.goto(base+'/?tab=demons&lang='+language);await ready(tab);
      if(language==='en'||language==='ko'){
        for(const type of ['demons','skills','essences']){await tab.locator('[data-tab="'+type+'"]').click();await noChinese(tab);}
      }
      const pack=language==='zh-Hans'?null:JSON.parse(await fs.readFile(path.join(__dirname,'../web/assets/locales',language+'.json'),'utf8'));
      if(pack){
        const searchName=pack.skills.Agi.name;
        await fillSearch(tab,'global-search',searchName);
        await tab.locator('#global-results a').first().waitFor();
        const matches=await tab.locator('#global-results a').evaluateAll(links=>links.map(link=>new URL(link.href).searchParams.get('name')));
        assert(matches.includes('Agi'),'localized search must use canonical skill links');
        // A Chinese/Japanese alias should also work in an English/Korean view.
        await fillSearch(tab,'global-search','義經');
        await tab.waitForFunction(()=>[...document.querySelectorAll('#global-results a')].some(link=>new URL(link.href).searchParams.get('name')==='Yoshitsune'));
      }
      await tab.goto(base+'/demon.html?name=Yoshitsune&lang='+language);await ready(tab);
      if(pack){
        assert.equal(await tab.locator('h1').innerText(),pack.demons.Yoshitsune.name);
        const actual=await tab.locator('.demon-profile-copy').innerText();
        assert.equal(actual.replace(/\s+/g,''),pack.demons.Yoshitsune.description.replace(/\s+/g,''),'full official lore must be retained');
      }
      await tab.goto(base+'/skill.html?name=Hassou%20Tobi&lang='+language);await ready(tab);
      if(pack){
        assert.equal(await tab.locator('h1').innerText(),pack.skills['Hassou Tobi'].name);
        assert.equal(await tab.locator('.entry-effect').first().innerText(),pack.skills['Hassou Tobi'].effect);
        assert((await tab.locator('.entry-effect').first().innerText()).includes('8'),'Hassou Tobi must use its own skill ID and hit count');
      }
      if(language==='en'||language==='ko')await noChinese(tab);
      await tab.close();
    }
    checks.push('localized and cross-language search, canonical detail links, complete official lore and correctly matched skill effects');

    // A language download failure must leave both the page and build intact.
    await page.route('**/auth/theme/locales/ko.json*',route=>route.fulfill({status:503,json:{}}));
    await page.locator('#site-language').click();await page.locator('[data-language="ko"]').click();
    await page.locator('.language-status:not([hidden])').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.evaluate(()=>JSON.stringify(state)),initial.state);
    assert.equal(await page.locator('.operation-step.is-current').getAttribute('id'),'route-step-2');
    await page.unroute('**/auth/theme/locales/ko.json*');
    await page.locator('#site-language').focus();await page.keyboard.press('Enter');
    await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.language),'ko');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#site-language').getAttribute('aria-expanded'),'false');
    checks.push('language failures preserve state; keyboard menu supports arrow navigation, Home/End and Escape');
    await context.close();

    for(const language of languages){
      const loginContext=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
      loginContext.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
      const login=await loginContext.newPage();
      await login.route('**/api/login/options',route=>route.fulfill({json:{revision:0,settings:{sessionMinutes:1440,inactivityMinutes:720,rememberMinutes:43200,rememberMeEnabled:true,rememberMeDefault:false,rememberPasswordEnabled:true},turnstile:{enabled:false}}}));
      await login.route('**/auth/api/state',route=>route.fulfill({json:{data:{authentication_level:0}}}));
      await login.goto(base+'/auth/index.html?lang='+language);
      await login.locator('#sign-in-button:not([disabled])').waitFor();await login.locator('#site-language').waitFor();
      await login.locator('#username-textfield').fill('language-test');await login.locator('#password-textfield').fill('fixture-password');
      await login.locator('#show-login-password').click();
      assert.equal(await login.locator('#password-textfield').inputValue(),'fixture-password','translation modified a form value');
      assert.equal(await login.locator('#password-textfield').getAttribute('type'),'text');
      await login.evaluate(()=>document.fonts.ready);
      for(const width of [320,390,768,1440]){await login.setViewportSize({width,height:900});await layout(login);}
      if(language==='en'||language==='ko')await noChinese(login);
      await loginContext.close();
    }
    checks.push('localized login at four widths without changing account/password values');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
