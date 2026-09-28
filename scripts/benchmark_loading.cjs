'use strict';
// Real HTTP only. Cold disables the browser cache; warm primes the same page.
// CDP wire bytes include HTTP overhead; Resource Timing bytes describe payloads
// and can include cached bodies, so do not interpret warm payloads as transfers.
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('../tests/playwright.cjs');
const base = process.env.SMTVV_URL || 'http://127.0.0.1:8769';
const mode = process.env.SMTVV_BENCHMARK_CACHE || 'cold';
if (!['cold','warm'].includes(mode) || !process.argv[2]) throw Error('Pass an output JSON path; SMTVV_BENCHMARK_CACHE may be cold or warm');
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));

(async () => {
  const args=['--no-sandbox'];
  // A workstation proxy must not send localhost benchmarks through its own
  // loopback interface (notably when the proxy runs on Windows and origin in WSL).
  if (['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) args.push('--no-proxy-server');
  const browser = await chromium.launch({args});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const page = await context.newPage();
    const failures=[], cancellations=[], errors=[], responses=new Map();
    page.on('requestfailed',request => {
      const item={path:new URL(request.url()).pathname,error:request.failure()?.errorText};
      // Installing an available official logo cancels its generic placeholder.
      // Record that expected cancellation separately from transport failures.
      if(item.path==='/assets/planner-mark.svg'&&item.error==='net::ERR_ABORTED') cancellations.push(item);
      else failures.push(item);
    });
    page.on('pageerror',error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:mode==='cold'});
    const response = id => {
      if (!responses.has(id)) responses.set(id,{});
      return responses.get(id);
    };
    cdp.on('Network.responseReceived',event => Object.assign(response(event.requestId),{
      path:new URL(event.response.url).pathname,status:event.response.status,cached:!!event.response.fromDiskCache,
    }));
    cdp.on('Network.responseReceivedExtraInfo',event => {response(event.requestId).networkStatus=event.statusCode;});
    cdp.on('Network.loadingFinished',event => {response(event.requestId).wireBytes=event.encodedDataLength;});
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(2000);
      window.loadingMarks={};
      new PerformanceObserver(list => {window.loadingMarks.lcp=list.getEntries().at(-1)?.startTime;})
        .observe({type:'largest-contentful-paint',buffered:true});
    });
    async function ready() {
      await page.waitForFunction(() => document.body.dataset.catalogState === 'ready',{},{timeout:20000});
    }
    async function allImages() {
      await page.evaluate(() => {for(const image of document.querySelectorAll('.demon-record img'))image.loading='eager';});
      await page.waitForFunction(() => [...document.querySelectorAll('.demon-record img')].every(image => image.complete && image.naturalWidth),{},{timeout:30000});
    }
    if (mode==='warm') {
      await page.goto(base+'/?tab=demons',{waitUntil:'domcontentloaded'});
      await ready();
      await page.evaluate(() => document.fonts.ready);
      await allImages();
      if (failures.length || errors.length) throw Error('Cache priming failed: '+JSON.stringify({failures,errors}));
      responses.clear();
    }
    await page.goto(base+'/?tab=demons',{waitUntil:'domcontentloaded'});
    await ready();
    const readyMs=await page.evaluate(() => performance.now());
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('.demon-record img')]
      .filter(image => image.getBoundingClientRect().top < innerHeight)
      .every(image => image.complete && image.naturalWidth),{},{timeout:15000});
    await pause(250);
    async function snapshot() {
      const state=await page.evaluate(() => ({
        now:performance.now(),lcp:window.loadingMarks.lcp,
        galleryCount:document.querySelectorAll('.demon-record img[data-demon-portrait]').length,
        images:[...document.querySelectorAll('.demon-portrait')].filter(image=>image instanceof HTMLImageElement)
          .map(image=>({src:image.currentSrc,width:image.naturalWidth,complete:image.complete,visible:!!image.getClientRects().length&&image.getBoundingClientRect().top<innerHeight})),
        resources:performance.getEntriesByType('resource').map(entry=>({path:new URL(entry.name).pathname,type:entry.initiatorType,
          bytes:entry.encodedBodySize,transfer:entry.transferSize,start:entry.startTime,duration:entry.duration})),
      }));
      state.network=[...responses.values()].filter(item=>item.path).map(item=>({...item}));
      return state;
    }
    const initial=await snapshot();
    await allImages();
    const complete=await snapshot();
    const invalid=complete.network.filter(item=>item.status>=400);
    const valid=!failures.length && !errors.length && !invalid.length;
    const result={base,mode,readyMs,initial,complete,failures,cancellations,errors,invalid,valid};
    await fs.mkdir(path.dirname(process.argv[2]),{recursive:true});
    await fs.writeFile(process.argv[2],JSON.stringify(result,null,2));
    for(const [name,state] of Object.entries({initial,complete})) {
      const bytes=state.resources.reduce((sum,entry)=>sum+entry.bytes,0);
      const imageBytes=state.resources.filter(entry=>entry.type==='img').reduce((sum,entry)=>sum+entry.bytes,0);
      const wireBytes=state.network.reduce((sum,entry)=>sum+(entry.wireBytes||0),0);
      console.log(JSON.stringify({name,mode,valid,readyMs,now:state.now,lcp:state.lcp,
        requests:state.resources.length,bytes,imageBytes,wireBytes,portraits:state.images.length,failures,errors}));
    }
    if (!valid) process.exitCode=1;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
