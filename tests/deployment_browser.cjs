const {chromium}=require('./playwright.cjs');
const {firefox,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const base=process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const engine=process.env.SMTVV_TEST_BROWSER || 'chromium';
const expectedCDN=process.env.SMTVV_EXPECT_CDN || 'cloudflare';
assert(['cloudflare','axisnow'].includes(expectedCDN),'Choose cloudflare or axisnow');
assert(['chromium','firefox','webkit'].includes(engine),'Choose chromium, firefox or webkit');
const artifact=name=>__dirname+'/deployment-'+engine+'-'+name;
const secrets=[];
const config={target:'Yoshitsune',skills:['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul']};

(async()=>{
  const browser=await ({chromium,firefox,webkit}[engine]).launch(engine==='chromium'?{args:['--no-sandbox']}:{headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN',reducedMotion:'reduce'});
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  const errors=[],starts=[],failures=[],apiHeaders=[];
  const checks=[];
  let loggedOut=false;
  let phase='login';
  const diagnostics=[];
  page.on('pageerror',error=>{errors.push(error.message);diagnostics.push({phase,name:error.name,message:error.message,stack:error.stack,path:new URL(page.url()).pathname});});
  page.on('requestfailed',request=>diagnostics.push({phase,path:new URL(request.url()).pathname,error:request.failure()?.errorText}));
  page.on('request',request=>{
    if(request.url().endsWith('/api/optimal/start'))starts.push(request.postDataJSON());
  });
  page.on('response',response=>{
    if(response.status()>=400 && !(loggedOut && response.status()===401))failures.push({url:response.url(),status:response.status()});
    if(response.url().includes('/api/optimal/'))apiHeaders.push(response);
  });
  try {
    if(process.env.SMTVV_CREDENTIALS_FILE) {
      assert(base.startsWith('https://'),'Public credential checks require HTTPS');
      const credentials=await fs.readFile(process.env.SMTVV_CREDENTIALS_FILE,'utf8');
      const username=credentials.match(/^Username:\s*(\S+)$/m)?.[1];
      const password=credentials.match(/^Password:\s*(\S+)$/m)?.[1];
      assert(username && password,'A private credentials file is required');
      secrets.push(password);
      const hostname=new URL(base).hostname;
      const legacy=['/','/auth/','/api/','/admin/'].map(path=>({name:'smtvv_session',
        value:'stale-session-fixture',domain:'.'+hostname,path,secure:true,httpOnly:true,sameSite:'Lax'}));
      if(hostname.split('.').length>=3)legacy.push({...legacy[0],domain:'.'+hostname.split('.').slice(1).join('.')});
      await context.addCookies(legacy);
      await page.goto(base+'/',{waitUntil:'domcontentloaded'});
      await page.waitForURL(url=>url.pathname.startsWith('/auth/'));
      await page.locator('input[autocomplete="username"], #username-textfield').first().fill(username);
      await page.locator('input[type="password"]').first().fill(password);
      const [login]=await Promise.all([
        page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/api/firstfactor'),
        page.getByRole('button',{name:/Sign in|登录|登入/i}).first().click(),
      ]);
      assert.equal(login.status(),200);
      await page.waitForURL(url=>!url.pathname.startsWith('/auth/'));
      await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('275'));
      const cookie=(await context.cookies(base)).find(item=>/^smtvv_session_[a-f0-9]{12}$/.test(item.name));
      assert(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite==='Lax');
      secrets.push(cookie.value);
      checks.push('original credentials work with old parent and path cookies still present');
    }
    phase='configuration';
    const navigation=await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify(config)));
    // Changing only the configuration fragment is a same-document navigation.
    if(navigation)assert.equal(navigation.status(),200);
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('275'));
    await page.waitForFunction(expected=>state.target===expected.target && state.skills.length===expected.skills.length,config);
    await page.waitForTimeout(900);
    assert.equal(starts.length,0,'public configuration is a draft until Generate is clicked');
    assert.equal(await page.locator('#skill-count').textContent(),'8 / 8');
    await page.screenshot({path:artifact('build.png')});
    const started=Date.now();
    phase='calculation';
    await page.locator('#calculate').click();
    await page.waitForFunction(()=>currentPage?.finished||document.querySelector('#error')?.textContent,{}, {timeout:60000});
    const calculationSeconds=Math.round((Date.now()-started)/10)/100;
    assert.equal(await page.locator('#error').textContent(),'');
    let result=await page.evaluate(()=>currentPage);
    assert(result.complete);
    assert.equal(starts.length,1);
    assert.equal(result.jobId,starts[0].requestId);
    assert.deepEqual(Object.keys(result.solutions),['mixed']);
    assert.equal(starts[0].objective,'mixed');
    for(const objective of ['shortest','cheapest']) {
      assert.match(await page.locator(`.strategy[data-optimal="${objective}"]`).textContent(),/点击计算/);
      await page.locator(`.strategy[data-optimal="${objective}"]`).click();
      await page.waitForFunction(key=>currentPage?.finished&&currentPage?.computedObjectives?.includes(key),objective,{timeout:60000});
    }
    result=await page.evaluate(()=>currentPage);
    assert.deepEqual(Object.keys(result.solutions).sort(),['cheapest','mixed','shortest']);
    assert.deepEqual(starts.map(request=>request.objective),['mixed','shortest','cheapest']);
    await page.locator('.strategy[data-optimal="mixed"]').click();
    for(const route of Object.values(result.solutions)){
      assert(route.validated);
      assert.deepEqual(route.skills,config.skills);
    }
    assert.equal(result.solutions.shortest.stepCount,4);
    assert.equal(result.solutions.mixed.operationCount,4);
    await page.waitForFunction(()=>[...document.images].filter(image=>image.loading!=='lazy').every(image=>image.complete&&image.naturalWidth));
    await page.screenshot({path:artifact('route.png')});
    const download=page.waitForEvent('download');
    await page.locator('#export-text').click();
    await(await download).saveAs(artifact('route.txt'));
    await page.reload();
    await page.waitForFunction(()=>currentPage?.complete);
    assert.equal(starts.length,3,'reload restores completed routes without another job');
    checks.push('mixed by default, two on-demand calculations, three validated routes, export and refresh without duplicate work');
    phase='libraries';
    for(const tab of ['demons','skills','essences','planner']) {
      await page.locator('[data-tab="'+tab+'"]').click();
      await page.locator('#tab-'+tab).waitFor({state:'visible'});
    }
    for(const detail of ['/demon.html?name=Alice','/skill.html?name=Megidolaon','/essence.html?name=Angel']) {
      assert.equal((await page.goto(base+detail,{waitUntil:'domcontentloaded'})).status(),200);
      await page.locator('.entry-heading').waitFor({state:'visible'});
      assert((await page.locator('.entry-heading').textContent()).trim().length>0);
    }
    checks.push('all four navigation tabs and demon, skill and essence detail pages');
    await page.goto(base+'/#config='+encodeURIComponent(JSON.stringify(config)));
    await page.waitForFunction(()=>currentPage?.complete);
    for(const width of [1000,1280,1440,1920]) {
      await page.setViewportSize({width,height:1050});
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'planner layout '+width);
    }
    await page.setViewportSize({width:1440,height:1050});
    const theme=await page.locator('html').getAttribute('data-theme');
    await page.locator('#site-theme').click();
    assert.notEqual(await page.locator('html').getAttribute('data-theme'),theme);
    await page.screenshot({path:artifact('planner-theme.png')});
    checks.push('planner layouts at four desktop widths and both themes');
    if(process.env.SMTVV_CREDENTIALS_FILE) {
      phase='administrator';
      assert.equal((await page.goto(base+'/admin/',{waitUntil:'domcontentloaded'})).status(),200);
      await page.waitForFunction(()=>document.querySelector('#health')?.textContent==='运行正常');
      const overview=await page.evaluate(()=>fetch('/api/admin/overview').then(r=>r.json()));
      assert.equal(overview.account.canChangePassword,true);
      const exported=await page.evaluate(()=>fetch('/api/admin/export').then(r=>r.json()));
      assert.deepEqual(Object.keys(exported).sort(),['schema','settings']);
      for(const width of [320,390,768,1024,1440]) {
        await page.setViewportSize({width,height:1050});
        await page.evaluate(()=>document.fonts.ready);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'admin layout '+width);
      }
      await page.screenshot({path:artifact('admin-desktop.png')});
      await page.locator('#theme').click();
      await page.screenshot({path:artifact('admin-theme.png')});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:artifact('admin-mobile.png')});
      checks.push('administrator overview, private export, five widths and both themes');
      phase='logout';
      await page.goto(base+'/auth/',{waitUntil:'domcontentloaded'});
      loggedOut=true;
      const [logout]=await Promise.all([
        page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/api/logout'),
        page.getByRole('button',{name:/Logout|Log out|Sign out|退出|登出|注销/i}).first().click(),
      ]);
      assert.equal(logout.status(),200);
      assert.equal(await page.evaluate(()=>fetch('/api/catalog').then(r=>r.status)),401);
      checks.push('logout revokes access');
    }
    const responses=[];
    for(const response of apiHeaders){
      const headers=await response.allHeaders();
      assert.match(headers['cache-control']||'',/no-store/);
      assert.notEqual(headers['cf-cache-status'],'HIT');
      if(base.startsWith('https://')) {
        if(expectedCDN==='cloudflare')assert(headers['cf-ray'],'public checks must pass through Cloudflare');
        else assert.match(headers['x-cache']||'',/^BYPASS$/i,'AxisNow must bypass caching computation responses');
      }
      responses.push({path:new URL(response.url()).pathname,status:response.status(),cache:headers['cf-cache-status']||headers['x-cache'],cfRay:headers['cf-ray']});
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(failures,[]);
    const report={base,engine,passed:true,calculationSeconds,checks,
      automaticStarts:0,explicitStarts:starts.length,skills:config.skills.length,
      routes:Object.fromEntries(Object.entries(result.solutions).map(([key,route])=>[key,{operations:route.operationCount??route.stepCount,cost:route.totalCost,validated:route.validated}])),
      apiResponses:responses};
    await fs.writeFile(artifact('validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({url:base,engine,passed:true,starts:starts.length,routes:report.routes,checks}));
  } catch(error) {
    await page.screenshot({path:artifact('failure.png')}).catch(()=>{});
    console.error(JSON.stringify({pageErrors:errors,failedResponses:failures,diagnostics}));
    throw error;
  } finally {await context.close();await browser.close();}
})().catch(error=>{
  let message=error.stack || String(error);
  for(const secret of secrets)if(secret)message=message.split(secret).join('[REDACTED]');
  console.error(message);process.exitCode=1;
});
