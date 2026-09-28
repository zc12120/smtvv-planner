const {chromium}=require('./playwright.cjs');
const assert=require('node:assert/strict');
const base=process.env.SMTVV_URL||'http://[::1]:8766';
const config={target:'Angel',skills:['Agi','Dia']};
const strategy=(page,key)=>page.locator(`.strategy[data-optimal="${key}"]`);
async function solved(page,key){
 await page.waitForFunction(key=>currentPage?.finished&&currentPage?.computedObjectives?.includes(key),key,{timeout:30000});
 assert.equal(await page.locator('#error').textContent(),'');
}
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(),starts=[],cancels=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{
  if(r.url().endsWith('/api/optimal/start'))starts.push(r.postDataJSON());
  if(r.url().endsWith('/api/optimal/cancel'))cancels.push(r.postDataJSON());
 });
 try{
  await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify(config)));
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('275'));
  await page.locator('#calculate').click();await solved(page,'mixed');
  assert.deepEqual(starts.map(r=>r.objective),['mixed']);
  assert.deepEqual(await page.evaluate(()=>Object.keys(currentPage.solutions)),['mixed']);
  assert.match(await strategy(page,'cheapest').textContent(),/点击计算/);
  const original=await page.evaluate(()=>JSON.stringify(currentPage.solutions.mixed));

  // A pending additional search survives refresh alongside its completed result.
  let hold=true;
  await page.route('**/api/optimal/status',async route=>{
   if(hold&&route.request().postDataJSON().jobId===starts.at(-1)?.requestId&&starts.at(-1)?.objective==='shortest'){
    await route.fulfill({json:{jobId:starts.at(-1).requestId,finished:false,complete:false,objective:'shortest',computedObjectives:[],solutions:{},stage:'准备数据',seconds:1}});
   }else await route.continue();
  });
  await strategy(page,'shortest').click();
  await page.waitForFunction(()=>Boolean(activeJob));
  await page.reload();
  await page.waitForFunction(()=>Boolean(activeJob)&&currentPage?.solutions.mixed);
  assert.equal(starts.length,2,'refresh resumes the accepted on-demand task');
  assert.equal(await page.evaluate(()=>JSON.stringify(currentPage.solutions.mixed)),original);
  await page.locator('#route-cancel').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(currentPage.solutions.mixed)),original);
  await page.waitForFunction(()=>!busy&&currentPage.finished);
  assert.deepEqual(await page.evaluate(()=>currentPage.computedObjectives),['mixed']);
  hold=false;await page.unroute('**/api/optimal/status');
  assert.equal(cancels.at(-1).jobId,starts[1].requestId);

  // A failed additional request retains the completed route and retries its objective.
  let fail=true;
  await page.route('**/api/optimal/start',async route=>{
   if(fail&&route.request().postDataJSON().objective==='cheapest')await route.fulfill({status:400,json:{error:'测试补算失败'}});
   else await route.continue();
  });
  await strategy(page,'cheapest').click();await page.locator('#retry-compute').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>JSON.stringify(currentPage.solutions.mixed)),original);
  fail=false;await page.locator('#retry-compute').click();await solved(page,'cheapest');
  assert.equal(starts.at(-1).objective,'cheapest');
  assert.deepEqual((await page.evaluate(()=>currentPage.computedObjectives)).sort(),['cheapest','mixed','shortest']);
  const count=starts.length;
  for(const key of ['shortest','mixed','cheapest'])await strategy(page,key).click();
  await page.reload();await solved(page,'mixed');
  assert.equal(starts.length,count,'the cheapest byproduct and restored results never launch another task');
  assert.equal(await page.evaluate(()=>JSON.stringify(currentPage.solutions.mixed)),original);

  // An infeasible requested strategy must leave the other two available on demand.
  await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify({...config,starting:[]})));
  await page.waitForFunction(()=>currentPage===null);
  await page.locator('#calculate').click();await solved(page,'mixed');
  assert.match(await strategy(page,'mixed').textContent(),/无可行路线/);
  assert.match(await strategy(page,'shortest').textContent(),/点击计算/);
  assert.equal(await strategy(page,'shortest').isEnabled(),true);
  await strategy(page,'shortest').click();await solved(page,'shortest');
  assert.match(await strategy(page,'shortest').textContent(),/无可行路线/);
  assert.match(await strategy(page,'cheapest').textContent(),/点击计算/);
  assert.deepEqual(errors,[]);
  console.log('PASS: mixed default; pending refresh/cancel and error retry preserve completed routes; cheapest byproduct and reload reuse results; infeasible and uncomputed strategies remain distinct');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
