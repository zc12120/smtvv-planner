'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {chromium} = require('./playwright.cjs');
const {useStaticFixture} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const ready = page => page.waitForFunction(() => document.body.dataset.catalogState==='ready',{}, {timeout:25000});
const portrait = '.entry-heading img[data-demon-portrait="Pixie"]';
const loaded = page => page.waitForFunction(selector => {
  const image=document.querySelector(selector);
  return image?.complete && image.naturalWidth>0 && image.dataset.portraitState==='loaded';
},portrait);

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    async function scenario(name, options, run) {
      const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});
      await useStaticFixture(context,base);
      await context.addInitScript(() => performance.setResourceTimingBufferSize(2000));
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.setDefaultTimeout(15000);
      try {
        await run(page,context);
        assert.deepEqual(errors,[],name+': script errors');
        console.log('PASS '+name);
      } catch(error) {
        await page.screenshot({path:__dirname+'/performance-failure.png'}).catch(()=>{});
        throw error;
      } finally {await context.close();}
    }

    await scenario('a failed stylesheet reloads without requiring page refresh',{},async page=>{
      let attempts=0;
      await page.route('**/experience.css*',route=>++attempts===1?route.abort('connectionreset'):route.fallback());
      await page.goto(base+'/',{waitUntil:'domcontentloaded'}); await ready(page);
      await page.waitForFunction(()=>[...document.querySelectorAll('link[rel="stylesheet"]')]
        .some(link=>link.href.includes('/experience.css')&&link.dataset.stylesheetRetries==='1'&&link.sheet));
      assert.equal(attempts,2);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    });

    await scenario('catalog readiness does not wait for optional artwork',{},async page=>{
      let release;
      const gate=new Promise(resolve=>{release=resolve;});
      await page.route('**/assets/demons/manifest.json*',async route=>{await gate;await route.fallback();});
      try {
        await page.goto(base+'/?tab=demons',{waitUntil:'domcontentloaded'}); await ready(page);
        assert.match(await page.locator('#status').textContent(),/275/);
        assert.equal(await page.locator('.demon-record').count(),275);
      } finally {release();}
    });

    let hasOptimized=false;
    for(const dpr of [1,2,3]) await scenario('responsive portrait quality at DPR '+dpr,{deviceScaleFactor:dpr},async page=>{
      const requests=[], failures=[];
      page.on('request',request=>requests.push(new URL(request.url()).pathname));
      page.on('requestfailed',request=>{
        if(new URL(request.url()).pathname==='/assets/planner-mark.svg'&&request.failure()?.errorText==='net::ERR_ABORTED')return;
        failures.push(request.url());
      });
      await page.goto(base+'/?tab=demons'); await ready(page);
      await page.evaluate(()=>GameSite.portraitReady);
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>[...document.querySelectorAll('.demon-record img')]
        .filter(image=>image.getBoundingClientRect().top<innerHeight)
        .every(image=>image.complete&&image.naturalWidth));
      const images=await page.evaluate(()=>[...document.querySelectorAll('.demon-record img[data-demon-portrait]')]
        .filter(image=>image.getBoundingClientRect().top<innerHeight).map(image=>{
          const record=GameSite.demonUI.portraits.get(image.dataset.demonPortrait);
          const box=image.getBoundingClientRect();
          const selected=record.optimized?.variants.find(item=>item.src===new URL(image.currentSrc).pathname);
          const width=Math.min(box.width,box.height*record.display.width/record.display.height);
          return {name:image.dataset.demonPortrait,optimized:!!record.optimized,selected,
            required:Math.min(record.display.width,width*devicePixelRatio)};
        }));
      if(images.some(image=>image.optimized)) hasOptimized=true;
      for(const image of images.filter(image=>image.optimized)) {
        assert(image.selected,'selected variant belongs to the verified portrait: '+image.name);
        assert(image.selected.width+1>=image.required,'sufficient physical resolution: '+JSON.stringify(image));
      }
      assert.equal(requests.filter(path=>path==='/api/catalog').length,1,'early catalog request is consumed exactly once');
      assert.equal(requests.filter(path=>path==='/assets/demons/manifest.json').length,1,'early manifest request is consumed exactly once');
      assert(!requests.includes('/assets/fonts/noto-sans-sc.woff2'),'initial page uses CJK subsets without fetching the whole fallback');
      assert.deepEqual(failures,[],'successful requests required for transfer checks');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(dpr===2) await page.screenshot({path:__dirname+'/performance-dpr-2.png'});
    });

    await scenario('language is restored before localization and all four entrypoints load',{},async(page,context)=>{
      await context.addInitScript(()=>localStorage.setItem('smtvv-language','ko'));
      for(const entry of ['/?tab=demons&lang=ja','/demon.html?name=Pixie&lang=ja','/skill.html?name=Dia&lang=ja','/essence.html?name=Pixie&lang=ja']) {
        let release;
        const gate=new Promise(resolve=>{release=resolve;});
        await page.route('**/auth/theme/i18n.js*',async route=>{await gate;await route.continue();});
        try {
          await page.goto(base+entry,{waitUntil:'domcontentloaded'});
          assert.equal(await page.locator('html').getAttribute('lang'),'ja','URL language takes precedence before localization executes');
        } finally {release();}
        await ready(page);
        await page.unroute('**/auth/theme/i18n.js*');
        await page.evaluate(()=>document.fonts.ready);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      }
    });

    if(hasOptimized) {
      await scenario('a failed responsive candidate retries the same physical image', {deviceScaleFactor:2}, async page=>{
        const attempts=[];
        await page.route('**/assets/demons/optimized/pixie-*.webp*',route=>{
          attempts.push(route.request().url());
          return attempts.length===1?route.abort('connectionreset'):route.continue();
        });
        await page.goto(base+'/demon.html?name=Pixie'); await ready(page); await loaded(page);
        assert.equal(attempts.length,2,'retry does not additionally fetch the smallest src candidate');
        assert.equal(new URL(attempts[0]).pathname,new URL(attempts[1]).pathname);
        assert(new URL(attempts[1]).searchParams.has('retry'));
        assert.equal(await page.locator(portrait).getAttribute('data-portrait-source'),'optimized');
      });

      await scenario('missing WebP files recover through the original cropped PNG',{},async page=>{
        await page.route('**/assets/demons/optimized/pixie-*.webp*',route=>route.abort());
        await page.goto(base+'/demon.html?name=Pixie'); await ready(page); await loaded(page);
        assert.equal(await page.locator(portrait).getAttribute('data-portrait-source'),'display');
        assert.equal(await page.locator(portrait).getAttribute('srcset'),null);
        assert.match(await page.locator(portrait).getAttribute('src'),/\/display\/pixie\.png/);
      });

      await scenario('missing optimized and cropped assets recover through the native PNG',{},async page=>{
        await page.route('**/assets/demons/optimized/pixie-*.webp*',route=>route.abort());
        await page.route('**/assets/demons/display/pixie.png*',route=>route.abort());
        await page.goto(base+'/demon.html?name=Pixie'); await ready(page); await loaded(page);
        assert.equal(await page.locator(portrait).getAttribute('data-portrait-source'),'native');
        assert.match(await page.locator(portrait).getAttribute('class'),/--native/);
      });

      await scenario('complete portrait failure retains an accessible placeholder',{},async page=>{
        await page.route('**/assets/demons/optimized/pixie-*.webp*',route=>route.abort());
        await page.route('**/assets/demons/display/pixie.png*',route=>route.abort());
        await page.route('**/assets/demons/pixie.png*',route=>route.abort());
        await page.goto(base+'/demon.html?name=Pixie'); await ready(page);
        const missing=page.locator('.entry-heading [data-portrait-state="missing"]');
        await missing.waitFor();
        assert.equal(await missing.getAttribute('role'),'img');
        assert.match(await missing.getAttribute('aria-label'),/Pixie.*暂不可用/);
        assert.equal(await page.locator('.entry-heading h1').count(),1);
      });

      await scenario('invalid optional variants fall back to valid original metadata',{},async page=>{
        await page.route('**/assets/demons/manifest.json*',async route=>{
          // This scenario intentionally supplies malformed optional metadata.
          const manifest=JSON.parse(await fs.readFile(__dirname+'/../web/assets/demons/manifest.json','utf8'));
          manifest.demons.Pixie.optimized={format:'webp',variants:[null,{src:'https://invalid.example/image.webp',width:96,height:96},{src:'/assets/demons/optimized/pixie-abcdef123456-96.webp',width:-1,height:96}]};
          await route.fulfill({json:manifest});
        });
        await page.goto(base+'/demon.html?name=Pixie'); await ready(page); await loaded(page);
        assert.equal(await page.locator(portrait).getAttribute('data-portrait-source'),'display');
      });

      await scenario('failed images are recovered when a cached card is reattached',{},async page=>{
        await page.goto(base+'/demon.html?name=Pixie'); await ready(page); await loaded(page);
        await page.route('**/assets/demons/optimized/pixie-*.webp*',route=>route.abort());
        await page.evaluate(async selector=>{
          const image=document.querySelector(selector),parent=image.parentElement;
          image.remove();
          const source=image.currentSrc||image.src;
          image.removeAttribute('srcset');image.removeAttribute('sizes');
          await new Promise(resolve=>{image.addEventListener('error',resolve,{once:true});image.src=source+'?detached-test=1';});
          parent.append(image);
          GameSite.demonUI.hydrate(parent);
        },portrait);
        await loaded(page);
        assert.equal(await page.locator(portrait).getAttribute('data-portrait-source'),'display');
      });
    } else console.log('SKIP portrait variant failure cases: optional optimized artwork is not installed');

    await scenario('preloaded JSON keeps a deadline while the response body is stalled',{},async(page,context)=>{
      await context.addInitScript(()=>{
        const original=window.fetch.bind(window);
        window.catalogFetchCalls=0;
        window.fetch=(url,options)=>{
          if(String(url).startsWith('/api/catalog')&&++window.catalogFetchCalls===1) {
            const body=new ReadableStream({start(controller){
              options.signal.addEventListener('abort',()=>controller.error(new DOMException('test stalled body','AbortError')),{once:true});
            }});
            return Promise.resolve(new Response(body,{headers:{'Content-Type':'application/json'}}));
          }
          return original(url,options);
        };
      });
      await page.goto(base+'/',{waitUntil:'domcontentloaded'}); await ready(page);
      assert.equal(await page.evaluate(()=>window.catalogFetchCalls),2);
      assert.equal(await page.locator('#error').textContent(),'');
    });
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
