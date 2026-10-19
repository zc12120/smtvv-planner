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
  let days=7,before=0,next=0,busy=false,loaded=false,last=0,items=[],version=0,series=[],trendData;
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
  function selectDay(index){
    const selected=series[index];if(!selected)return;
    root.querySelectorAll('[data-analytics-day]').forEach(node=>{
      const active=Number(node.dataset.analyticsDay)===index;
      node.setAttribute('aria-pressed',String(active));node.setAttribute('tabindex',active?'0':'-1');
    });
    $('analytics-chart-detail').innerHTML=`<strong>${esc(selected.day)}</strong><span>${number(selected.views)} 次页面访问</span><span>${number(selected.ips)} 个独立 IP</span>`;
  }
  function trend(data){
    trendData=data;
    const start=new Date(Date.now()+8*3600000);start.setUTCHours(0,0,0,0);
    series=[];for(let i=days-1;i>=0;i--){const key=new Date(start.getTime()-i*86400000).toISOString().slice(0,10);series.push(data.trend.find(r=>r.day===key)||{day:key,views:0,ips:0});}
    if(!data.views){
      $('analytics-chart').innerHTML=`<div class="analytics-chart-empty">${icon('ChartNoAxesCombined')}<p>这个时间范围还没有访问记录</p><small>收到新访问后会自动绘制趋势</small></div>`;
      $('analytics-chart-detail').textContent='暂无访问数据';return;
    }
    const width=Math.max(320,Math.floor($('analytics-chart').clientWidth),days*12+58);
    const max=Math.max(1,...series.map(r=>r.views)),ceiling=Math.ceil(max/4)*4,left=42,right=width-16,top=16,bottom=176,step=(right-left)/series.length;
    const x=i=>left+(i+.5)*step,y=value=>bottom-value/ceiling*(bottom-top);
    const grid=[0,.5,1].map(r=>`<line class="analytics-grid" x1="${left}" y1="${y(ceiling*r)}" x2="${right}" y2="${y(ceiling*r)}"/><text class="analytics-axis" x="${left-10}" y="${y(ceiling*r)+4}" text-anchor="end">${number(ceiling*r)}</text>`).join('');
    const labelIndices=[...new Set([0,...(series.length>7?[Math.round((series.length-1)/2)]:[]),series.length-1])];
    const labels=labelIndices.map(i=>`<text class="analytics-axis" x="${x(i)}" y="202" text-anchor="middle">${series[i].day.slice(5)}</text>`).join('');
    const bars=series.map((r,i)=>`<rect class="analytics-view-bar" x="${x(i)-Math.min(step*.28,22)}" y="${y(r.views)}" width="${Math.min(step*.56,44)}" height="${bottom-y(r.views)}" rx="3"/>`).join('');
    const line=`<polyline class="analytics-ip-line" points="${series.map((r,i)=>x(i)+','+y(r.ips)).join(' ')}"/>`;
    const targets=series.map((r,i)=>`<g class="analytics-day" data-analytics-day="${i}" role="button" tabindex="${i===series.length-1?'0':'-1'}" aria-pressed="${i===series.length-1}" aria-label="${r.day}：${r.views} 次页面访问，${r.ips} 个独立 IP"><rect class="analytics-day-hit" x="${left+i*step}" y="${top}" width="${step}" height="${bottom-top}"/><line class="analytics-day-guide" x1="${x(i)}" y1="${top}" x2="${x(i)}" y2="${bottom}"/><circle class="analytics-ip-point" cx="${x(i)}" cy="${y(r.ips)}" r="${series.length>30?2:3.5}"/><title>${r.day}：${r.views} 次访问，${r.ips} 个 IP</title></g>`).join('');
    $('analytics-chart').innerHTML=`<div class="analytics-chart-scroll"><svg class="analytics-plot" style="min-width:${width}px" viewBox="0 0 ${width} 212" role="group" aria-label="最近 ${days} 天访问趋势；可点击日期，或用左右方向键切换">${grid}${bars}${line}${targets}${labels}</svg></div>`;
    $('analytics-chart').firstElementChild.scrollLeft=width;
    selectDay(series.length-1);
  }
  function rankings(data){
    const groups=[['pages','热门页面','FileText'],['regions','访客地区','MapPin'],['sources','访问来源','Compass'],['devices','设备','Monitor'],['browsers','浏览器','Globe2']];
    $('analytics-rankings').innerHTML=groups.map(([key,title,name])=>`<article><h3>${icon(name)}${title}</h3><ol>${(data.top[key]||[]).slice(0,5).map((r,i)=>{
      const share=Math.min(100,Math.max(0,Math.round(r.count/Math.max(data.views,1)*100))),label=key==='pages'?pageLabel(r.label):r.label;
      return `<li><div class="analytics-rank-row"><span class="analytics-rank-label" title="${esc(label)}"><em>${String(i+1).padStart(2,'0')}</em>${esc(label)}</span><span class="analytics-rank-value"><b>${number(r.count)}</b><small>${share}%</small></span></div><div class="analytics-rank-track" aria-hidden="true"><span style="width:${share}%"></span></div></li>`;
    }).join('')||'<li class="analytics-rank-empty">暂无记录</li>'}</ol></article>`).join('');
  }
  function summary(data){
    $('analytics-views').textContent=number(data.views);$('analytics-ips').textContent=number(data.ips);$('analytics-visitors').textContent=number(data.visitors);$('analytics-calculations').textContent=number(data.calculations?.submitting);
    $('analytics-duration').textContent=duration(data.duration);
    trend(data);rankings(data);
    status(data.relay);
  }
  function visits(data){
    items=data.items||[];next=data.next||0;
    $('analytics-visits').innerHTML=items.length?items.map((r,i)=>`<tr><td><strong>${esc(stamp(r.at))}</strong></td><td><button class="analytics-ip-button" type="button" data-visit-ip="${esc(r.ip)}">${esc(r.ip)}</button><small>${esc([r.country,r.region,r.city].filter(Boolean).join(' · '))}<br>${esc(r.isp)}</small></td><td><strong>${esc(pageLabel(r.path))}</strong>${r.actions.length?`<small class="analytics-row-action">${icon('GitBranch')}路线操作 ${r.actions.length} 次</small>`:''}</td><td><strong class="analytics-device">${icon({'手机':'Smartphone','平板':'Tablet','机器人':'Bot'}[r.device]||'Monitor')}${esc(r.device)} · ${esc(r.browser)}</strong><small>${esc(r.os)}<br>${esc(r.referrer||'直接访问 / 未提供来源')}</small></td><td>${r.duration?duration(r.duration):'—'}</td><td><button type="button" class="quiet" data-visit-detail="${i}" aria-label="查看 ${esc(r.ip)} 的访问详情">${icon('Eye')}查看</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty-state">没有符合条件的访问记录。</td></tr>';
    $('analytics-page-note').textContent=`本页 ${items.length} 条${before?' · 较早记录':''}${data.more?' · 还有更多':''}`;
    $('analytics-export').href='/api/admin/analytics?'+options('export');
  }
  for(const name of ['pointerover','focusin','click'])$('analytics-chart').addEventListener(name,event=>{
    const target=event.target.closest('[data-analytics-day]');if(target)selectDay(Number(target.dataset.analyticsDay));
  });
  $('analytics-chart').addEventListener('keydown',event=>{
    const target=event.target.closest('[data-analytics-day]');if(!target)return;
    const index=Number(target.dataset.analyticsDay),key=event.key;
    if(!['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(key))return;
    event.preventDefault();const next=key==='Home'?0:key==='End'?series.length-1:Math.max(0,Math.min(series.length-1,index+(key==='ArrowLeft'?-1:key==='ArrowRight'?1:0)));
    selectDay(next);$('analytics-chart').querySelector(`[data-analytics-day="${next}"]`)?.focus();
  });
  if(window.ResizeObserver){let previousWidth=0;new ResizeObserver(entries=>{
    const width=Math.round(entries[0].contentRect.width);if(width===previousWidth)return;previousWidth=width;if(trendData)trend(trendData);
  }).observe($('analytics-chart'));}
  async function refresh(includeSummary=true){
    if(busy)return;busy=true;controls();message('');const current=++version;
    try{
      if(includeSummary){const data=await request('summary');if(current!==version)return;if(data.enabled===false){message('访问统计尚未启用。');$('analytics-health').textContent='尚未启用';$('analytics-health').dataset.state='offline';return;}summary(data);}
      const data=await request('visits');if(current!==version)return;visits(data);status(data.relay);loaded=true;last=Date.now();
    }catch(error){message(error.message||'统计暂时不可用，稍后刷新即可。');$('analytics-health').dataset.state='offline';$('analytics-health').innerHTML=icon('CircleAlert')+'<span>玻尔1 · 等待连接</span>';}
    finally{busy=false;controls();}
  }
  root.querySelectorAll('[data-analytics-days]').forEach(button=>button.onclick=()=>{days=Number(button.dataset.analyticsDays);before=0;root.querySelectorAll('[data-analytics-days]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refresh();});
  $('analytics-filter').onsubmit=event=>{event.preventDefault();before=0;refresh();};
  $('analytics-reset').onclick=()=>{$('analytics-ip').value='';$('analytics-path').value='';before=0;refresh();};
  $('analytics-next').onclick=()=>{before=next;refresh(false);};
  $('analytics-refresh').onclick=()=>{before=0;refresh();};
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
