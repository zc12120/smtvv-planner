'use strict';
(() => {
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root=$('analytics');if(!root)return;
  function icon(name){
    const definition=window.lucide?.icons[name];if(!definition)return '';
    const node=lucide.createElement(definition);node.setAttribute('class','icon');node.setAttribute('aria-hidden','true');return node.outerHTML;
  }
  const number=v=>Number(v||0).toLocaleString('zh-CN');
  const duration=v=>v>=60?Math.floor(v/60)+' 分 '+Math.round(v%60)+' 秒':Math.round(v||0)+' 秒';
  const stamp=v=>new Date(v*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const labels={planner:'合体规划',demons:'仲魔全书',skills:'技能资料',essences:'灵体资料'};
  function pageLabel(path){const url=new URL(path,location.origin);return ['/', '/index.html'].includes(url.pathname)?labels[url.searchParams.get('tab')]||'合体规划':({ '/demon.html':'仲魔', '/skill.html':'技能', '/essence.html':'灵体'}[url.pathname]||url.pathname)+(url.searchParams.get('name')?' · '+url.searchParams.get('name'):'');}
  let days=7,before=0,next=0,busy=false,loaded=false,last=0,items=[],version=0;
  function message(value){$('analytics-message').textContent=value;$('analytics-message').hidden=!value;}
  function controls(){root.querySelectorAll('button:not(#analytics-detail-close):not(.analytics-ip-button)').forEach(b=>b.disabled=busy);$('analytics-next').disabled=busy||!next;}
  function options(mode){return new URLSearchParams({mode,days:String(days),ip:$('analytics-ip').value.trim(),path:$('analytics-path').value.trim(),before:String(before)});}
  async function request(mode){
    return SmtvvCommon.requestJson('/api/admin/analytics?'+options(mode),{cache:'no-store',timeout:22000,label:'访问统计',onResponse:response=>{
      if([401,403].includes(response.status)){$('session-error').hidden=false;$('session-message').textContent='查看访问记录需要管理员登录。请重新登录后刷新统计。';}
    }});
  }
  function status(relay){
    if(!relay)return;
    $('analytics-health').dataset.state=relay.online?'online':'offline';
    $('analytics-health').innerHTML=icon(relay.online?'Server':'CircleAlert')+'<span>玻尔1 · '+(relay.online?'已连接':'暂未连接')+' · 保留 60 天</span>';
    const stats=relay.node||{};
    $('analytics-storage').textContent=`已保存 ${number(stats.rows)} 条访问 · 数据库 ${((stats.databaseBytes||0)/1024/1024).toFixed(1)} MB · 地区库 ${stats.geoVersion||'等待同步'}${stats.lastPruned?' · 最近清理 '+stamp(stats.lastPruned):''}${relay.buffered?' · 待接收 '+number(relay.buffered)+' 条':''}${relay.dropped?' · 缓冲满后遗漏 '+number(relay.dropped)+' 条':''}`;
  }
  const charts=createAnalyticsCharts({root,number,pageLabel,icon,onPage:path=>{$('analytics-path').value=path;before=0;refresh();}});
  async function summary(data){
    $('analytics-views').textContent=number(data.views);$('analytics-ips').textContent=number(data.ips);$('analytics-visitors').textContent=number(data.visitors);$('analytics-calculations').textContent=number(data.calculations?.submitting);
    $('analytics-duration').textContent=duration(data.duration);
    $('analytics-sessions').textContent=number(data.sessions);
    $('analytics-depth').textContent='每会话浏览 '+(data.sessions?data.views/data.sessions:0).toFixed(1)+' 页';
    $('analytics-coverage').textContent='统计时区：北京时间 · 30 秒摘要缓存'+(data.firstAt?' · 所选范围首条记录 '+stamp(data.firstAt):'')+' · 最近刷新 '+stamp(Date.now()/1000);
    try{await charts.render(data);}catch(error){message(error.message);}
    status(data.relay);
  }
  function visits(data){
    items=data.items||[];next=data.next||0;
    $('analytics-visits').innerHTML=items.length?items.map((r,i)=>`<tr><td><strong>${esc(stamp(r.at))}</strong></td><td><button class="analytics-ip-button" type="button" data-visit-ip="${esc(r.ip)}">${esc(r.ip)}</button><small>${esc([r.country,r.region,r.city].filter(Boolean).join(' · '))}<br>${esc(r.isp)}</small></td><td><strong>${esc(pageLabel(r.path))}</strong>${r.actions.length?`<small class="analytics-row-action">${icon('GitBranch')}路线操作 ${r.actions.length} 次</small>`:''}</td><td><strong class="analytics-device">${icon({'手机':'Smartphone','平板':'Tablet','机器人':'Bot'}[r.device]||'Monitor')}${esc(r.device)} · ${esc(r.browser)}</strong><small>${esc(r.os)}<br>${esc(r.referrer||'直接访问 / 未提供来源')}</small></td><td>${r.duration?duration(r.duration):'—'}</td><td><button type="button" class="quiet" data-visit-detail="${i}" aria-label="查看 ${esc(r.ip)} 的访问详情">${icon('Eye')}查看</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty-state">没有符合条件的访问记录。</td></tr>';
    $('analytics-page-note').textContent=`本页 ${items.length} 条${before?' · 较早记录':''}${data.more?' · 还有更多':''}`;
    $('analytics-export').href='/api/admin/analytics?'+options('export');
  }
  async function refresh(includeSummary=true){
    if(busy)return;busy=true;controls();message('');const current=++version;
    try{
      if(includeSummary){const data=await request('summary');if(current!==version)return;if(data.enabled===false){message('访问统计尚未启用。');$('analytics-health').textContent='尚未启用';$('analytics-health').dataset.state='offline';return;}await summary(data);}
      const data=await request('visits');if(current!==version)return;visits(data);status(data.relay);loaded=true;last=Date.now();
    }catch(error){message(error.message||'统计暂时不可用，稍后刷新即可。');$('analytics-health').dataset.state='offline';$('analytics-health').innerHTML=icon('CircleAlert')+'<span>玻尔1 · 等待连接</span>';}
    finally{busy=false;controls();}
  }
  root.querySelectorAll('[data-analytics-days]').forEach(button=>button.onclick=()=>{days=Number(button.dataset.analyticsDays);before=0;root.querySelectorAll('[data-analytics-days]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refresh();});
  $('analytics-filter').onsubmit=event=>{event.preventDefault();before=0;refresh();};
  $('analytics-reset').onclick=()=>{$('analytics-ip').value='';$('analytics-path').value='';before=0;refresh();};
  $('analytics-next').onclick=()=>{before=next;refresh(false);};
  $('analytics-refresh').onclick=()=>{before=0;refresh();};
  $('analytics-visits-refresh').onclick=()=>{before=0;refresh(false);};
  $('analytics-detail-close').onclick=()=>$('analytics-detail').close();
  $('analytics-visits').onclick=event=>{
    const ip=event.target.closest('[data-visit-ip]');if(ip){$('analytics-ip').value=ip.dataset.visitIp;before=0;refresh();return;}
    const button=event.target.closest('[data-visit-detail]');if(!button)return;const r=items[Number(button.dataset.visitDetail)];
    const facts=[['时间',stamp(r.at)],['IP',r.ip],['地区',[r.country,r.region,r.city].filter(Boolean).join(' · ')],['运营商',r.isp],['页面',pageLabel(r.path)],['路径',r.path],['来源',r.referrer||'未提供'],['设备',`${r.device} · ${r.browser} · ${r.os}`],['窗口',r.viewport],['浏览器标识',r.ua],['访客标识',r.visitor],['会话标识',r.session],['可见停留',r.duration+' 秒']];
    const phases={submitting:'开始生成',completed:'生成完成',failed:'生成失败',cancelled:'取消生成'};
    $('analytics-detail-body').innerHTML=`<dl>${facts.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v||'—')}</dd>`).join('')}</dl><h3>路线操作</h3><ol>${r.actions.map(a=>`<li>${esc(stamp(a.at))} · ${esc(phases[a.phase]||a.phase)} · ${esc(a.target)}</li>`).join('')||'<li>本次页面访问没有路线操作。</li>'}</ol>`;
    $('analytics-detail').showModal();
  };
  const visible=()=>root.getBoundingClientRect().top<innerHeight&&root.getBoundingClientRect().bottom>0;
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&(!loaded||Date.now()-last>60000))refresh();});observer.observe(root);
  setInterval(()=>{if(!document.hidden&&visible()&&Date.now()-last>60000)refresh();},60000);
})();
