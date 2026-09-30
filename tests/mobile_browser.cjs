'use strict';
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const base=process.env.SMTVV_URL||'http://127.0.0.1:8766';
const output=process.env.SMTVV_MOBILE_ARTIFACTS||'/tmp/smtvv-mobile-acceptance';
(async()=>{
  await fs.mkdir(output,{recursive:true});const records=[];
  for(const [engine,type] of Object.entries({chromium,webkit})) {
    const browser=await type.launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox','--no-proxy-server']}:{})});
    try {
      const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      for(const language of ['zh-Hans','en','ja']) {
        await page.goto(base+'/?lang='+language+'#config='+encodeURIComponent(JSON.stringify({target:'Alice',skills:['Die For Me!','Megidolaon','Enduring Soul']})));
        await page.waitForFunction(()=>document.body.dataset.catalogState==='ready');
        const original=await page.evaluate(()=>JSON.stringify(state));
        for(const width of [320,360,390,430])for(const font of ['standard','large']) {
          await page.setViewportSize({width,height:844});await page.evaluate(font=>document.documentElement.dataset.font=font,font);
          for(const skin of ['smtv','p5','p3r'])for(const theme of ['light','dark']) {
            await page.evaluate(({skin,theme})=>Object.assign(document.documentElement.dataset,{skin,theme}),{skin,theme});
            const measure=await page.evaluate(()=>{
              const b=document.querySelector('#calculate').getBoundingClientRect();
              const small=[...document.querySelectorAll('.slot-replace,.slot-remove')].filter(e=>e.getClientRects().length).some(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44;});
              const first=document.querySelector('.build-panel').getBoundingClientRect();
              return {width:innerWidth,scroll:document.documentElement.scrollWidth,buttonVisible:b.top>=0&&b.bottom<=innerHeight,small,buildTop:first.top+scrollY};
            });
            assert.equal(measure.scroll,measure.width,JSON.stringify({engine,language,font,skin,theme,measure}));
            assert(measure.buttonVisible,'generate action must stay in viewport');assert(!measure.small,'touch targets');
            assert(measure.buildTop<650,'configuration should follow target summary');
          }
          await page.locator('.slot-replace').first().click();
          const dialog=await page.evaluate(()=>{
            const root=document.querySelector('#skill-dialog'),options=document.querySelector('#skill-options');
            const labels=[...options.querySelectorAll('.option-skill-title .skill-name')].slice(0,8).map(e=>e.getBoundingClientRect().width);
            return {width:innerWidth,scroll:document.documentElement.scrollWidth,outer:root.scrollHeight-root.clientHeight,columns:getComputedStyle(options).gridTemplateColumns.split(' ').length,smallestLabel:Math.min(...labels)};
          });
          assert.equal(dialog.columns,1);assert(dialog.outer<=2,JSON.stringify(dialog));assert(dialog.smallestLabel>=70,JSON.stringify(dialog));
          records.push({engine,language,width,font,...dialog});
          if(width===390&&font==='standard'&&language==='zh-Hans')await page.screenshot({path:output+'/'+engine+'-skill-dialog.png'});
          await page.locator('#close-dialog').click();assert.equal(await page.evaluate(()=>JSON.stringify(state)),original);
        }
      }
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(()=>Object.assign(document.documentElement.dataset,{font:'standard',skin:'smtv',theme:'light'}));
      await page.goto(base+'/?lang=zh-Hans#config='+encodeURIComponent(JSON.stringify({target:'Alice',skills:['Die For Me!','Megidolaon','Enduring Soul'],dlc:[],excluded:['Slime'],prices:{Pixie:123}})));
      await page.waitForFunction(()=>document.body.dataset.catalogState==='ready');
      await page.screenshot({path:output+'/'+engine+'-build.png',fullPage:true});
      assert.match(await page.locator('#settings-summary').innerText(),/限制|自定义价格/);
      await page.locator('#calculate').click();await page.waitForFunction(()=>currentPage?.complete,{},{timeout:90000});
      assert.equal(await page.evaluate(()=>state.dlc.length),0,'hidden DLC preference must remain unchanged');
      assert(await page.locator('.route-mobile-summary').count()>0);
      await page.screenshot({path:output+'/'+engine+'-route.png',fullPage:true});
      for(const tab of ['demons','skills','essences']){
        await page.locator('[data-tab="'+tab+'"]').click();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      }
      await page.locator('.catalog-card:visible [data-catalog-preview]').first().click();
      await page.locator('#catalog-preview').waitFor({state:'visible'});await page.keyboard.press('Escape');
      assert.deepEqual(errors,[]);
    } finally {await browser.close();}
  }
  await fs.writeFile(output+'/measurements.json',JSON.stringify(records,null,2));
  console.log(JSON.stringify({passed:true,engines:2,dialogLayouts:records.length,configurationLayouts:records.length*6,checks:['single-column picker','readable skill titles','one dialog scroll area','44px touch targets','persistent generate action','preserved hidden constraints','real route','three libraries and preview']}));
})().catch(error=>{console.error(error);process.exitCode=1;});
