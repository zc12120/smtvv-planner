'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('./playwright.cjs');
const {useStaticFixture}=require('./browser_env.cjs');
const base=process.env.SMTVV_URL||'http://127.0.0.1:18766';
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await useStaticFixture(context,base);
  let requests=0;
  await context.route('**/api/site*',async route=>{requests++;await route.continue();});
  const page=await context.newPage();
  await page.clock.install();
  await page.goto(base+'/');
  await page.waitForFunction(()=>document.body.dataset.catalogState==='ready');
  await page.evaluate(()=>GameSite.siteState);
  const initial=requests;
  await page.clock.fastForward(59000);
  assert.equal(requests,initial,'no repeated state poll before sixty seconds');
  const next=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/site');
  await page.clock.fastForward(2000);await next;
  assert.equal(requests,initial+1,'one state poll after sixty seconds');
  console.log('PASS: public site state polls every sixty seconds');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
