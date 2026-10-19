'use strict';
// Page events bypass shared CDN caches; no polling or image-request collection.
(() => {
  const random = () => crypto.randomUUID();
  function identifier(storage,key) {
    try {const old=storage.getItem(key);if (/^[a-zA-Z0-9-]{16,64}$/.test(old||''))return old;const value=random();storage.setItem(key,value);return value;}catch{return random();}
  }
  function path() {
    const url=new URL(location.href);
    if (['/','/index.html'].includes(url.pathname))return '/?tab='+(['planner','demons','skills','essences'].includes(url.searchParams.get('tab'))?url.searchParams.get('tab'):'planner');
    return url.pathname+(url.searchParams.has('name')?'?name='+encodeURIComponent(url.searchParams.get('name').slice(0,100)):'');
  }
  GameSite.catalog.then(catalog => {
    if (!catalog.analytics?.enabled)return;
    const visitor=identifier(localStorage,'smtvv-visitor-v1'),session=identifier(sessionStorage,'smtvv-visit-session-v1');
    let current,route='',activeAt=0,seconds=0;
    function send(kind,detail={}) {
      if (!current)return;
      const event={id:random(),visit:current,visitor,session,kind,path:route,referrer:document.referrer,viewport:innerWidth+'×'+innerHeight,...detail};
      const blob=new Blob([JSON.stringify(event)],{type:'application/json'});
      try {if (!navigator.sendBeacon('/api/analytics/collect',blob))fetch('/api/analytics/collect',{method:'POST',body:blob,keepalive:true,credentials:'same-origin'}).catch(()=>{});}catch{}
    }
    function pause() {
      if (!activeAt)return;
      seconds+=Math.max(0,(performance.now()-activeAt)/1000);activeAt=0;
      send('leave',{duration:Math.min(86400,Math.round(seconds))});
    }
    function track() {
      const next=path();if(next===route)return;
      pause();route=next;current=random();seconds=0;activeAt=document.hidden?0:performance.now();
      send('page');
    }
    for (const method of ['pushState','replaceState']) {
      const original=history[method];history[method]=function(...args){const result=original.apply(this,args);queueMicrotask(track);return result;};
    }
    window.addEventListener('popstate',track);
    window.addEventListener('pagehide',pause);
    window.addEventListener('pageshow',()=>{if(!document.hidden&&!activeAt)activeAt=performance.now();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else if(!activeAt)activeAt=performance.now();});
    window.addEventListener('smtvv:calculation',event=>send('calculation',event.detail));
    track();
  }).catch(()=>{});
})();
