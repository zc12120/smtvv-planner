'use strict';
const {chromium}=require('./playwright.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.SMTVV_URL||'http://127.0.0.1:8766';
const output=path.join(__dirname,'../outputs/route-release-20260917');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 try {
  await fs.mkdir(output,{recursive:true});
  const page=await browser.newPage({viewport:{width:1663,height:1050},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify({target:'Angel',skills:['Pierce Armor','Acrobat Kick','Agibarion','Almighty Pleroma','Agi','Agilao']})));
  await page.waitForFunction(()=>document.body.dataset.catalogState==='ready');
  await page.locator('#calculate').click();
  await page.waitForFunction(()=>currentPage?.complete,{},{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  const route=await page.evaluate(()=>lastResult);
  const data=await page.locator('.ledger-step').evaluateAll(steps=>steps.map(step=>({result:[...step.querySelectorAll('[data-role="result"] [data-skill]')].map(e=>e.dataset.skill),provided:[...step.querySelectorAll('[data-role="input"] [data-skill], [data-role="essence"] [data-skill]')].map(e=>e.dataset.skill)})));
  data.forEach((step,i)=>{assert.deepEqual([...step.result].sort(),[...route.steps[i].keep].sort());assert.deepEqual([...step.provided].sort(),[...(route.steps[i].type==='essence'?route.steps[i].keep:route.steps[i].inherit)].sort());assert.equal(new Set(step.provided).size,step.provided.length);});
  assert(await page.locator('.ledger-skill-note [data-origin]').count()>0,'alternative provider remains reachable without duplicating the skill');
  assert.equal(await page.locator('[data-complete],.guide-progress,footer,.about,.ledger-source-group').count(),0);
  const layouts=[];
  async function check(){
   const result=await page.evaluate(()=>({width:innerWidth,font:document.documentElement.dataset.font,overflow:document.documentElement.scrollWidth>innerWidth,clipped:[...document.querySelectorAll('.route-ledger button,.route-ledger a,.ledger-node')].filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.className),misplaced:[...document.querySelectorAll('.ledger-node')].filter(e=>e.querySelector('.ledger-node-skills').getBoundingClientRect().top<e.querySelector('.ledger-person').getBoundingClientRect().bottom).length}));
   assert.equal(result.overflow,false,JSON.stringify(result));assert.deepEqual(result.clipped,[],JSON.stringify(result));assert.equal(result.misplaced,0);layouts.push(result);
  }
  for(const width of [320,390,768,1280,1663])for(const font of ['standard','large']){await page.setViewportSize({width,height:1050});await page.evaluate(font=>document.documentElement.dataset.font=font,font);await check();}
  await page.evaluate(()=>document.documentElement.dataset.font='standard');await page.setViewportSize({width:1663,height:1050});
  await page.locator('.ledger-step').last().screenshot({path:path.join(output,'complex-desktop.png')});
  await page.setViewportSize({width:390,height:1050});await page.locator('.ledger-step').last().screenshot({path:path.join(output,'complex-mobile.png')});
  // Real special recipe with the largest material count exercises wrapping even
  // when a calculated route happens to use mostly dyad fusions.
  const ingredients=await page.evaluate(()=>{
   const demon=catalog.demons.filter(d=>d.special?.length).sort((a,b)=>b.special.length-a.special.length)[0];
   const materials=demon.special.map((name,i)=>({id:'m'+i,name,level:dm[name].level,learn:[],price:0}));
   const route={found:true,target:demon.name,objective:'layout-fixture',materials,skills:[],steps:[{id:'s1',type:'fusion',special:true,result:demon.name,ingredients:demon.special,materialIds:materials.map(m=>m.id),inherit:[],learn:[],keep:[],level:demon.level}]};
   const root=document.querySelector('#result');root.replaceChildren();RouteGuide.render(root,route,{catalog,state,demons:dm,skillLink,entryLink,configKey,exportText,skillName:sn});return demon.special.length;
  });
  assert(ingredients>=4);
  for(const width of [320,390,768,1280,1663]){await page.setViewportSize({width,height:1050});await check();}
  assert.equal(await page.locator('.ledger-equation-many [data-role="input"]').count(),ingredients);
  await page.locator('.ledger-step').screenshot({path:path.join(output,'special-desktop.png')});
  assert.deepEqual(errors,[]);
  const record={ok:true,complexSteps:data.length,uniqueSkillProviders:true,layouts:layouts.length,specialIngredients:ingredients};
  await fs.writeFile(path.join(output,'layout.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
