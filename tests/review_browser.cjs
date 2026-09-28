const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {useStaticFixture} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const config = {target:'Angel',skills:['Dia']};
const configURL = value => base + '/#config=' + encodeURIComponent(JSON.stringify(value));
const ready = page => page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
const pending = jobId => ({jobId,finished:false,complete:false,error:'',message:'',stage:'排队等待计算',seconds:1,solutions:{},priceMode:'baseline'});

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  const checks = [];
  async function scenario(name, run) {
    const context = await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    try {
      await run(page, context);
      assert.deepEqual(errors, [], name + ': browser errors');
      checks.push({name,passed:true});
      console.log('PASS ' + name);
    } catch (error) {
      await page.screenshot({path:__dirname+'/review-failure.png'}).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  try {
    await scenario('a failed core script is retried before dependent scripts run', async page => {
      let requests=0;
      await page.route('**/site.js*', route => {requests++;return requests===1?route.abort('connectionreset'):route.fallback();});
      await page.goto(configURL(config)); await ready(page);
      assert.equal(requests,2);
      assert.equal(await page.evaluate(()=>state.target),'Angel');
      assert.equal(await page.locator('#error').textContent(),'');
      await page.unroute('**/site.js*');
      requests=0;
      await page.route('**/entry.js*', route => {requests++;return requests===1?route.abort('connectionreset'):route.fallback();});
      await page.goto(base+'/demon.html?name=Angel');
      await page.locator('.entry-heading').waitFor();
      assert.equal(requests,2);
    });

    await scenario('persistent script failure offers a working reload without cascading errors', async page => {
      let requests=0;
      await page.route('**/assets/icons.js*', route => {requests++;return route.abort('connectionreset');});
      await page.goto(configURL(config));
      await page.locator('#retry-data').waitFor({state:'visible'});
      assert.equal(requests,3);
      assert.match(await page.locator('#error').textContent(),/页面资源/);
      await page.unroute('**/assets/icons.js*');
      await page.locator('#retry-data').click(); await ready(page);
      assert.equal(await page.evaluate(()=>state.target),'Angel');
    });

    await scenario('navigation while catalog is loading preserves the draft', async page => {
      let release;
      const gate = new Promise(resolve => { release=resolve; });
      await page.route('**/api/catalog*', async route => { await gate; await route.continue(); });
      try {
        await page.goto(configURL(config), {waitUntil:'domcontentloaded'});
        assert(await page.locator('#example').isDisabled());
        assert(await page.locator('#clear-skills').isDisabled());
        await page.locator('[data-tab="demons"]').click();
      } finally { release(); }
      await ready(page);
      assert.equal(await page.locator('[data-tab="demons"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.evaluate(() => state.target), 'Angel');
      assert.deepEqual(await page.evaluate(() => state.skills), ['Dia']);
    });

    await scenario('malformed shared and entry parameters cannot break initialization', async page => {
      for (const value of [
        {target:'__proto__',skills:['constructor',null,['Dia']]},
        {target:['Angel'],skills:[{},'toString']},
        {target:'Angel',skills:['Dia','Dia',{},'constructor'],locked:['__proto__'],prices:{constructor:1}}
      ]) {
        await page.goto(configURL(value)); await ready(page);
        assert.equal(await page.locator('#error').textContent(), '');
        assert.deepEqual(await page.evaluate(() => state.skills), value.target==='Angel'?['Dia']:[]);
      }
      await page.goto(base+'/?target=__proto__&addSkill=constructor'); await ready(page);
      assert.equal(await page.locator('#error').textContent(), '');
    });

    await scenario('essence attribute filter survives refresh and tab restoration', async page => {
      await page.goto(base+'/?tab=essences'); await ready(page);
      await page.selectOption('#essence-element','phy');
      const count = await page.locator('#essence-count').textContent();
      await page.reload(); await ready(page);
      assert.equal(await page.locator('#essence-element').inputValue(), 'phy');
      assert.equal(await page.locator('#essence-count').textContent(), count);
      await page.locator('[data-tab="planner"]').click();
      await page.reload(); await ready(page);
      await page.locator('[data-tab="essences"]').click();
      assert.equal(await page.locator('#essence-element').inputValue(), 'phy');
      assert.equal(await page.locator('#essence-count').textContent(), count);
    });

    await scenario('refresh resumes one accepted job and cancellation clears it', async page => {
      const starts = [], statuses = [];
      await page.route('**/api/optimal/start', route => {
        const id=route.request().postDataJSON().requestId; starts.push(id);
        return route.fulfill({json:{jobId:id}});
      });
      await page.route('**/api/optimal/status', route => {
        const id=route.request().postDataJSON().jobId; statuses.push(id);
        return route.fulfill({json:pending(id)});
      });
      await page.goto(configURL(config)); await ready(page);
      await page.locator('#calculate').click();
      await page.waitForFunction(() => currentPage?.jobId);
      assert(await page.locator('#route-status').isVisible());
      assert.match(await page.locator('#route-status').textContent(), /排队/);
      const before = statuses.length;
      await page.reload(); await ready(page);
      await page.waitForFunction(() => currentPage?.jobId);
      assert.equal(starts.length,1);
      assert(statuses.length>before);
      assert.equal(new Set(statuses).size,1);
      await page.screenshot({path:__dirname+'/review-running.png'});
      await page.locator('#route-cancel').click();
      assert.equal(await page.evaluate(() => sessionStorage.getItem('smtvv-active-request-v1')),null);
      const cancelled = statuses.length;
      await page.reload(); await ready(page);
      assert.equal(starts.length,1);
      assert.equal(statuses.length,cancelled);
    });

    await scenario('refresh during a lost start response reuses the request id', async page => {
      const starts=[];
      await page.route('**/api/optimal/start', route => {
        const id=route.request().postDataJSON().requestId; starts.push(id);
        if(starts.length===1)return route.abort('connectionreset');
        return route.fulfill({json:{jobId:id}});
      });
      await page.route('**/api/optimal/status', route => route.fulfill({json:pending(route.request().postDataJSON().jobId)}));
      await page.goto(configURL(config)); await ready(page);
      await page.locator('#calculate').click();
      await page.waitForFunction(() => document.querySelector('#route-status').textContent.includes('重试'));
      await page.reload(); await ready(page);
      await page.waitForFunction(() => currentPage?.jobId);
      assert(starts.length>=2);
      assert.equal(new Set(starts).size,1,'a lost response must not create a second computation');
    });

    await scenario('expired resumed job waits for an explicit retry', async page => {
      let expired=false;
      const starts=[];
      await page.route('**/api/optimal/start', route => {
        const id=route.request().postDataJSON().requestId; starts.push(id);
        return route.fulfill({json:{jobId:id}});
      });
      await page.route('**/api/optimal/status', route => expired
        ? route.fulfill({status:400,json:{error:'生成任务已过期，请重新生成。'}})
        : route.fulfill({json:pending(route.request().postDataJSON().jobId)}));
      await page.goto(configURL(config)); await ready(page);
      await page.locator('#calculate').click(); await page.waitForFunction(() => currentPage?.jobId);
      expired=true;
      await page.reload(); await ready(page);
      await page.locator('#retry-compute').waitFor({state:'visible'});
      assert.match(await page.locator('#error').textContent(),/过期/);
      assert.equal(starts.length,1);
      expired=false;
      await page.locator('#retry-compute').click(); await page.waitForFunction(() => currentPage?.jobId);
      assert.equal(new Set(starts).size,2);
    });

    await scenario('rate limiting honors Retry-After and exposes retry status', async page => {
      const times=[];
      await page.route('**/api/optimal/start', route => {
        times.push(Date.now());
        if(times.length===1)return route.fulfill({status:429,headers:{'Retry-After':'1'},json:{error:'计算请求过于频繁，请稍后重试。'}});
        return route.fulfill({json:{jobId:route.request().postDataJSON().requestId}});
      });
      await page.route('**/api/optimal/status', route => route.fulfill({json:pending(route.request().postDataJSON().jobId)}));
      await page.goto(configURL(config)); await ready(page);
      await page.locator('#calculate').click();
      await page.waitForFunction(() => document.querySelector('#route-status').textContent.includes('服务繁忙'));
      assert(await page.locator('#route-status').isVisible());
      await page.waitForFunction(() => currentPage?.jobId);
      assert.equal(times.length,2);
      assert(times[1]-times[0]>=950,'Retry-After must delay the next submission');
    });

    await scenario('catalog failures offer recovery without losing saved configuration', async (page,context) => {
      await context.addInitScript(value => localStorage.setItem('smtvv-config-v1',JSON.stringify(value)),config);
      await page.route('**/api/catalog*', route => route.abort('connectionreset'));
      await page.goto(base);
      await page.locator('#retry-data').waitFor({state:'visible'});
      assert(await page.locator('#example').isDisabled());
      assert(await page.locator('#clear-skills').isDisabled());
      assert(!/Failed to fetch/.test(await page.locator('#error').textContent()));
      await page.unroute('**/api/catalog*');
      await page.locator('#retry-data').click(); await ready(page);
      assert.equal(await page.evaluate(() => state.target),'Angel');
      assert.deepEqual(await page.evaluate(() => state.skills),['Dia']);
    });

    await scenario('data requests time out, recover, and do not retry permanent 404s', async page => {
      await page.goto(base); await ready(page);
      const result=await page.evaluate(async () => {
        const original=window.fetch;
        let stalled=0,missing=0,offline=0;
        try {
          window.fetch=(url,options) => {
            if(url==='/test-stalled'){
              stalled++;
              if(stalled===1)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
              return Promise.resolve(new Response(JSON.stringify({recovered:true})));
            }
            if(url==='/test-missing'){missing++;return Promise.resolve(new Response(JSON.stringify({error:'没有找到该技能。'}),{status:404}));}
            offline++;return Promise.reject(new TypeError('Failed to fetch'));
          };
          const data=await GameSite.fetchJson('/test-stalled','资料读取失败',2,40);
          const missingError=await GameSite.fetchJson('/test-missing','资料读取失败').catch(e=>e.message);
          const offlineError=await GameSite.fetchJson('/test-offline','资料读取失败').catch(e=>e.message);
          return {stalled,missing,offline,data,missingError,offlineError};
        } finally {window.fetch=original;}
      });
      assert.equal(result.stalled,2);
      assert.equal(result.data.recovered,true);
      assert.equal(result.missing,1);
      assert.match(result.missingError,/没有找到/);
      assert.equal(result.offline,2);
      assert.match(result.offlineError,/暂时无法连接/);
      assert(!result.offlineError.includes('Failed to fetch'));
    });

    await scenario('detail errors have a retry action and sanitize unknown return tabs', async page => {
      let requests=0;
      await page.route('**/api/skill?name=Dia', route => {requests++;return route.abort('connectionreset');});
      await page.goto(base+'/skill.html?name=Dia&from=constructor');
      await page.locator('#retry-entry').waitFor({state:'visible'});
      assert.equal(requests,2);
      assert(!/Failed to fetch/.test(await page.locator('.error').textContent()));
      assert.equal(await page.locator('#detail-back').getAttribute('href'),'/?tab=skills');
      await page.unroute('**/api/skill?name=Dia');
      await page.locator('#retry-entry').click();
      await page.locator('.entry-heading').waitFor();
      assert.match(await page.locator('h1').textContent(),/迪亚/);
    });

    fs.writeFileSync(__dirname+'/review-browser-validation.json',JSON.stringify({url:base,staticFixture:process.env.SMTVV_STATIC_FROM_DISK==='1',checks},null,2)+'\n');
    console.log(`${checks.length} review scenarios passed`);
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
