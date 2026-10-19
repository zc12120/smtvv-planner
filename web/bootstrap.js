'use strict';
// Generated asset lists, shared loading and recovery for every application page.
(() => {
  const assets={"index.html":["/auth/theme/common.js?v=772c4ce244ba","/auth/theme/i18n.js?v=b9f374d09c52","/assets/icons.js?v=7b646f968889","/site.js?v=153c42f567fe","/skills-ui.js?v=ef18ceb0a663","/catalog-ui.js?v=071f353c36db","/route-guide.js?v=15db5963d158","/task-controller.js?v=0bd54875cd19","/app.js?v=337359e4d541","/inspector.js?v=dba569b57f99","/ui.js?v=84d94e7839c0","/analytics-client.js?v=0d25c5d2978e"],"demon.html":["/auth/theme/common.js?v=772c4ce244ba","/auth/theme/i18n.js?v=b9f374d09c52","/assets/icons.js?v=7b646f968889","/site.js?v=153c42f567fe","/skills-ui.js?v=ef18ceb0a663","/entry.js?v=6041f03829e1","/ui.js?v=84d94e7839c0","/analytics-client.js?v=0d25c5d2978e"],"skill.html":["/auth/theme/common.js?v=772c4ce244ba","/auth/theme/i18n.js?v=b9f374d09c52","/assets/icons.js?v=7b646f968889","/site.js?v=153c42f567fe","/skills-ui.js?v=ef18ceb0a663","/entry.js?v=6041f03829e1","/ui.js?v=84d94e7839c0","/analytics-client.js?v=0d25c5d2978e"],"essence.html":["/auth/theme/common.js?v=772c4ce244ba","/auth/theme/i18n.js?v=b9f374d09c52","/assets/icons.js?v=7b646f968889","/site.js?v=153c42f567fe","/skills-ui.js?v=ef18ceb0a663","/entry.js?v=6041f03829e1","/ui.js?v=84d94e7839c0","/analytics-client.js?v=0d25c5d2978e"],"admin/index.html":["/auth/theme/common.js?v=772c4ce244ba","/assets/icons.js?v=7b646f968889","/admin/admin.js?v=97bb1c85ebc0","/admin/analytics-charts.js?v=c1314e88df06","/admin/analytics.js?v=8ffe3562ea20"]};
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
