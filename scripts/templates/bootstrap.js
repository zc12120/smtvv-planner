'use strict';
// Generated asset lists, shared loading and recovery for every application page.
(() => {
  const assets=/* ASSET_MANIFEST */;
  const page=location.pathname==='/admin/'?'admin/index.html':location.pathname.split('/').pop()||'index.html';
  window.currentPage=null;
  (async()=>{
    for(const source of assets[page]||assets['index.html']) {
      for(let attempt=0;attempt<3;attempt++) {
        try {
          await new Promise((resolve,reject)=>{
            const script=document.createElement('script');
            const timer=setTimeout(()=>reject(Error('timeout')),12000);
            script.src=source+(attempt?'&loadRetry='+attempt:'');script.async=false;
            script.onload=()=>{clearTimeout(timer);resolve();};
            script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('network'));};
            document.body.append(script);
          });
          if(source.includes('/i18n.js'))await SmtvvI18n.ready;
          break;
        } catch(error) {
          if(error.message==='timeout'||attempt===2)throw error;
          await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));
        }
      }
    }
  })().catch(()=>{
    document.body.dataset.catalogState='error';
    document.querySelectorAll('[aria-busy="true"]').forEach(e=>e.setAttribute('aria-busy','false'));
    const status=document.getElementById('status')||document.getElementById('health');
    if(status)status.textContent='页面资源未就绪';
    const box=document.getElementById('error')||document.getElementById('entry-content')||document.getElementById('feedback-text');
    if(box){box.textContent='页面资源暂时无法加载，请重新加载。';box.setAttribute('role','alert');}
    const feedback=document.getElementById('feedback');if(feedback)feedback.hidden=false;
    const retry=document.getElementById('retry-data')||document.getElementById('refresh');
    if(retry){retry.hidden=false;retry.disabled=false;retry.textContent='重新加载';retry.onclick=()=>location.reload();}
  });
})();
