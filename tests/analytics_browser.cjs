'use strict';
const {chromium}=require('./playwright.cjs');
const {useStaticFixture}=require('./browser_env.cjs');
const assert=require('node:assert/strict');
const base=process.env.SMTVV_URL||'http://127.0.0.1:18767';
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--no-proxy-server']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await useStaticFixture(context,base);
  if(process.env.SMTVV_STATIC_FROM_DISK==='1')await context.route(base+'/admin/',async route=>route.fulfill({contentType:'text/html',body:await require('node:fs/promises').readFile(require('node:path').join(__dirname,'../web/admin/index.html'))}));
  await context.addCookies([{name:'test',value:'admin',url:base}]);
  const page=await context.newPage(),errors=[],events=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/analytics/collect')events.push(r.postDataJSON());});
  await page.goto(base+'/');await page.waitForFunction(()=>document.body.dataset.catalogState==='ready');
  await page.waitForFunction(()=>Boolean(window.GameSite));
  await page.locator('[data-tab="demons"]').click();
  await page.locator('[data-tab="skills"]').click();
  await page.goto(base+'/admin/#analytics');
  await page.locator('#analytics').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('#analytics-views').textContent!=='—');
  await page.waitForFunction(()=>document.querySelectorAll('[data-visit-detail]').length>0);
  assert(Number((await page.locator('#analytics-views').textContent()).replace(/,/g,''))>=65);
  assert.match(await page.locator('#analytics-storage').textContent(),/MB/);
  await page.locator('#analytics-next').click();
  await page.waitForFunction(()=>document.querySelector('#analytics-page-note').textContent.includes('较早'));
  await page.locator('#analytics-reset').click();
  await page.waitForFunction(()=>!document.querySelector('#analytics-next').disabled);
  await page.locator('[data-visit-detail]').first().click();
  await page.locator('#analytics-detail').waitFor({state:'visible'});
  assert.match(await page.locator('#analytics-detail-body').textContent(),/访客标识|浏览器标识/);
  await page.keyboard.press('Escape');
  await page.locator('#analytics-ip').fill('114.114.114.114');
  await page.locator('#analytics-filter button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#analytics-ips').textContent==='1');
  const csv=await context.request.get(base+await page.locator('#analytics-export').getAttribute('href'));
  assert.equal(csv.status(),200);assert.equal(csv.headers()['cache-control'],'no-store');
  assert.match(await csv.text(),/114\.114\.114\.114/);
  await page.locator('#analytics-ip').fill('bad-ip');await page.locator('#analytics-filter button[type="submit"]').click();
  await page.locator('#analytics-message').waitFor({state:'visible'});assert.match(await page.locator('#analytics-message').textContent(),/IP/);
  await page.locator('#analytics-reset').click();await page.waitForFunction(()=>!document.querySelector('#analytics-next').disabled);
  for(const width of [1440,390])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.locator('#analytics').scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.locator('#analytics').screenshot({path:'/tmp/smtvv-analytics-build/admin-'+width+'-'+theme+'.png'});
  }
  assert(events.filter(e=>e.kind==='page').length>=3,'page changes collected');
  assert(events.some(e=>e.kind==='leave'),'visible duration collected');
  assert.deepEqual(errors,[]);
  console.log('PASS: page events, duration, live relay/store, admin summary/details, filters, pagination, CSV, errors, desktop/mobile light/dark');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
