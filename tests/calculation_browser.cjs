const {chromium} = require('./playwright.cjs');
const assert = require('node:assert/strict');
const {useStaticFixture} = require('./browser_env.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8766';
const build = ['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul'];
const alice = {target:'Alice',skills:['Die For Me!','Megidolaon','Enduring Soul']};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve=done; });
  return {promise,resolve};
};

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('275'));
}
async function solved(page) {
  await page.waitForFunction(() => currentPage?.finished || document.querySelector('#error')?.textContent, {}, {timeout:45000});
  assert.equal(await page.locator('#error').textContent(),'');
  assert.equal(await page.evaluate(() => currentPage?.complete),true);
}
async function selectSkill(page, name) {
  await page.locator('#skill-slots .slot-empty[data-locked="false"]').first().click();
  await page.locator('#skill-search').fill(name);
  await page.locator(`[data-add="${name}"]`).click();
}
async function openConfig(page, config=alice) {
  await page.goto(base + '/#config=' + encodeURIComponent(JSON.stringify(config)));
  await ready(page);
}

(async () => {
  const browser=await chromium.launch({args:['--no-sandbox']});
  const errors=[];
  async function scenario(run) {
    const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
    await useStaticFixture(context,base);
    const page=await context.newPage();
    const starts=[],cancels=[],failedRequests=[];
    page.setDefaultTimeout(15000);
    page.on('pageerror',error => errors.push(error.message));
    page.on('requestfailed',request => failedRequests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText}));
    page.on('request',request => {
      if(request.url().endsWith('/api/optimal/start')) starts.push(request.postDataJSON());
      if(request.url().endsWith('/api/optimal/cancel')) cancels.push(request.postDataJSON());
    });
    try { await run(page,starts,cancels); }
    catch(error) {
      console.error('Browser diagnostics:',JSON.stringify({errors,failedRequests,state:await page.evaluate(()=>({path:location.pathname,readyState:document.readyState,status:document.querySelector('#status')?.textContent,lucide:typeof lucide,site:typeof GameSite})).catch(()=>null)}));
      await page.screenshot({path:__dirname+'/calculation-failure.png'}).catch(()=>{});
      throw error;
    } finally { await context.close(); }
  }
  try {
    await scenario(async(page,starts) => {
      await page.goto(base); await ready(page);
      await page.locator('[data-quick="Yoshitsune"]').click();
      await page.locator('#clear-skills').click();
      for(const [index,name] of build.entries()) {
        await selectSkill(page,name);
        if(index===0) await page.waitForTimeout(800);
        assert.equal(starts.length,0,'selecting any skill must not start a search');
      }
      await page.locator('[data-choose-source="Phys Pleroma"]').click();
      const source=page.locator('[data-set-source]:not(.automatic):not([disabled])').first();
      await source.click();
      await page.locator('[data-choose-source="Phys Pleroma"]').click();
      await page.locator('[data-set-source=""]').click();
      await page.locator('#level').fill('149'); await page.locator('#level').dispatchEvent('change');
      await page.locator('#level').fill('150'); await page.locator('#level').dispatchEvent('change');
      await page.waitForTimeout(800);
      assert.equal(starts.length,0,'source and condition changes remain drafts');
      assert.equal(await page.locator('#skill-count').textContent(),'8 / 8');
      assert.equal(await page.locator('#calculate').isEnabled(),true);
      assert.match(await page.locator('#compute-status').textContent(),/等待生成/);
      await page.screenshot({path:__dirname+'/calculation-ready.png'});

      const accepted=[];
      await page.route('**/api/optimal/start',async route => {
        const response=await route.fetch();
        accepted.push((await response.json()).jobId);
        if(accepted.length===1) await route.abort('connectionreset');
        else await route.fulfill({response});
      });
      let statuses=0;
      await page.route('**/api/optimal/status',async route => {
        statuses++;
        if(statuses===1) await route.abort('connectionreset');
        else if(statuses===2) await route.fulfill({status:503,contentType:'text/html',body:'Temporary interruption'});
        else await route.continue();
      });
      await page.locator('#calculate').click(); await solved(page);
      assert.equal(starts.length,2,'only the lost start response causes a retry');
      assert.equal(new Set(starts.map(request=>request.requestId)).size,1);
      assert.equal(new Set(accepted).size,1,'both start attempts refer to the same server job');
      assert.deepEqual(starts[0].skills,build,'the submitted snapshot contains all eight skills');
      assert.equal(await page.locator('.strategy').count(),3);
      assert(statuses>=3,'status requests recover from connection reset and a non-JSON 503');
      await page.screenshot({path:__dirname+'/calculation-routes.png'});
      const submitted=starts.length;
      await page.reload(); await ready(page); await solved(page);
      assert.equal(starts.length,submitted,'reload restores completed routes without starting a job');
      await page.locator('[data-planner-view="build"]').click();
      await page.locator('#target-card .target-head h3 a').click();
      await page.locator('.entry-heading').waitFor();
      await page.locator('#detail-back').click(); await ready(page); await solved(page);
      assert.equal(starts.length,submitted,'details return restores completed routes');
      await page.locator('[data-planner-view="build"]').click();
      await page.locator('[data-remove="7"]').click();
      await page.waitForTimeout(800);
      assert.equal(starts.length,submitted);
      assert.equal(await page.locator('#build-preview').isHidden(),true);
      assert.equal(await page.evaluate(()=>currentPage),null,'edited config cannot display an old route');
      await page.reload(); await ready(page); await page.waitForTimeout(800);
      assert.equal(starts.length,submitted,'a saved draft must not compute on reload');
      assert.equal(await page.evaluate(()=>currentPage),null,'cached routes must match all current skills');
      console.log('PASS: eight skills, source/settings edits and saved drafts wait for explicit generation; lost starts are deduplicated; polling recovers; completed routes survive reload/details');
    });

    await scenario(async(page,starts) => {
      let disconnected=true,statuses=0;
      await page.route('**/api/optimal/status',async route => {
        statuses++;
        if(disconnected) await route.abort('connectionreset');
        else await route.continue();
      });
      await openConfig(page);
      await page.waitForTimeout(800); assert.equal(starts.length,0,'shared links must not compute');
      await page.locator('#calculate').click();
      await page.locator('#retry-compute').waitFor({state:'visible'});
      assert.match(await page.locator('#generation-notice').textContent(),/本地计算服务/);
      assert.doesNotMatch(await page.locator('#generation-notice').textContent(),/Failed to fetch/i);
      assert.equal(statuses,3,'automatic retries are bounded');
      await page.waitForTimeout(800); assert.equal(statuses,3);
      assert.equal(await page.locator('#calculate').isEnabled(),true);
      await page.screenshot({path:__dirname+'/calculation-retry.png'});
      disconnected=false;
      await page.locator('#retry-compute').click(); await solved(page);
      assert.equal(starts.length,1,'retry resumes the accepted job instead of recomputing');
      assert.equal(await page.locator('#generation-notice').isHidden(),true);
      console.log('PASS: persistent disconnection shows a Chinese recovery message, stops after three attempts and resumes the same job on retry');
    });

    await scenario(async(page,starts,cancels) => {
      const accepted=deferred(),release=deferred();
      let held=true;
      await page.route('**/api/optimal/start',async route => {
        if(!held){await route.continue();return;}
        held=false;
        const response=await route.fetch();
        accepted.resolve();
        await release.promise;
        await route.fulfill({response});
      });
      try {
        await openConfig(page); await page.locator('#calculate').click(); await accepted.promise;
        await page.locator('#edit-build').click(); await page.locator('[data-remove="2"]').click();
        assert.equal(await page.locator('#calculate').isEnabled(),true);
        assert.equal(await page.locator('#cancel-compute').isHidden(),true);
        release.resolve();
        await page.waitForTimeout(900);
        assert.equal(starts.length,1,'editing while start is pending must not schedule another job');
        assert(cancels.some(request=>request.jobId===starts[0].requestId),'an accepted job can be cancelled even before its start response arrives');
        assert.equal(await page.evaluate(()=>currentPage),null,'late start response must not revive an obsolete result');
        assert.match(await page.locator('#compute-status').textContent(),/等待生成/);
        await page.locator('#calculate').click(); await solved(page);
        assert.equal(starts.length,2); assert.notEqual(starts[0].requestId,starts[1].requestId);
        assert.equal(starts[1].skills.length,2);
        console.log('PASS: editing during a delayed start cancels the accepted job; stale responses stay ignored; the next explicit generation uses the edited snapshot');
      } finally {release.resolve();}
    });

    await scenario(async(page,starts) => {
      const cancelled=deferred(),release=deferred();
      await page.route('**/api/optimal/cancel',async route => {
        const response=await route.fetch();
        cancelled.resolve();
        await release.promise;
        await route.fulfill({response});
      });
      // Hold the first job's status so it stays cancellable even on a fast machine.
      let firstJob='';
      await page.route('**/api/optimal/status',async route => {
        const id=route.request().postDataJSON().jobId;
        if(!firstJob) firstJob=id;
        if(id!==firstJob){await route.continue();return;}
        const response=await route.fetch();
        await release.promise;
        await route.fulfill({response});
      });
      try {
        await openConfig(page); await page.locator('#calculate').click();
        await page.waitForFunction(()=>Boolean(activeJob));
        await page.locator('#route-cancel').click(); await cancelled.promise;
        await page.locator('#edit-build').click();
        assert.equal(await page.locator('#calculate').isEnabled(),true,'cancel updates the UI without waiting for the network');
        await page.locator('#calculate').click(); await solved(page);
        const latest=await page.evaluate(()=>currentPage.jobId);
        release.resolve(); await page.waitForTimeout(900);
        assert.equal(starts.length,2);
        assert.equal(await page.evaluate(()=>currentPage.jobId),latest,'late cancellation and status responses cannot clear the new result');
        assert.equal(await page.evaluate(()=>currentPage.complete),true);
        console.log('PASS: cancel remains responsive, immediate restart succeeds and late cancellation/status responses cannot overwrite the new result');
      } finally {release.resolve();}
    });
    assert.deepEqual(errors,[],'no uncaught browser exceptions');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
