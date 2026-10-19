'use strict';
// Chart rendering runs in the administrator's browser; all values come from the private summary API.
window.createAnalyticsCharts = ({root,number,pageLabel,icon,onPage}) => {
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const instances=new Map();let runtime,loading,lastData,chartType='line',series=[],selected=0;
  function library(){
    if(window.SmtvvCharts)return Promise.resolve(window.SmtvvCharts);
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');let timer;
      function failed(){clearTimeout(timer);script.remove();loading=null;reject(Error('图表资源加载失败，请点击刷新统计重试。'));}
      script.src=root.dataset.chartsSrc;script.async=true;script.onerror=failed;
      script.onload=()=>{clearTimeout(timer);if(window.SmtvvCharts)resolve(window.SmtvvCharts);else failed();};
      timer=setTimeout(failed,20000);document.head.append(script);
    });return loading;
  }
  function palette(){
    const style=getComputedStyle(root),get=key=>style.getPropertyValue(key).trim();
    return {colors:['--chart-jade','--chart-blue','--chart-gold','--chart-violet','--chart-rose','--chart-slate','--chart-moss','--chart-other'].map(get),
      text:get('--text'),muted:get('--muted'),line:get('--line'),surface:get('--surface'),inset:get('--inset'),font:getComputedStyle(document.body).fontFamily};
  }
  function base(p){return {animation:false,color:p.colors,textStyle:{fontFamily:p.font,color:p.text,fontSize:12},
    aria:{enabled:true},tooltip:{renderMode:'richText',backgroundColor:p.surface,borderColor:p.line,textStyle:{color:p.text,fontFamily:p.font,fontSize:12},confine:true},
    legend:{textStyle:{color:p.muted,fontFamily:p.font,fontSize:12},inactiveColor:p.line,itemWidth:12,itemHeight:8,itemGap:20},
    backgroundColor:'transparent'};}
  function plot(id,option,p,empty=false){
    const node=$(id);let chart=instances.get(id);
    if(!chart){chart=runtime.init(node,null,{renderer:'svg'});instances.set(id,chart);observer.observe(node);}
    node.dataset.empty=String(empty);
    chart.setOption({...base(p),...option},true);
    node.dataset.chartReady='true';return chart;
  }
  function empty(id,p){return plot(id,{title:{text:'暂无访问数据',left:'center',top:'middle',textStyle:{fontFamily:p.font,fontSize:13,fontWeight:'normal',color:p.muted}},series:[]},p,true);}
  function axes(p){return {axisLine:{lineStyle:{color:p.line}},axisTick:{show:false},axisLabel:{color:p.muted,fontFamily:p.font,fontSize:11},splitLine:{lineStyle:{color:p.line,type:'dashed'}}};}
  function period(data){
    if(data.days===1)return Array.from({length:24},(_,hour)=>({label:String(hour).padStart(2,'0')+':00',...(data.hours||[]).find(r=>r.hour===hour)||{views:0,ips:0,visitors:0}}));
    const today=new Date(Date.now()+8*3600000);today.setUTCHours(0,0,0,0);
    return Array.from({length:data.days},(_,i)=>{const day=new Date(today.getTime()-(data.days-1-i)*86400000).toISOString().slice(0,10);return {label:day,...data.trend.find(r=>r.day===day)||{views:0,ips:0,visitors:0}};});
  }
  function select(index,tip=false){
    if(!series.length)return;selected=Math.max(0,Math.min(series.length-1,index));const r=series[selected];
    $('analytics-chart-detail').textContent=`${r.label}  ·  ${number(r.views)} 次访问  ·  ${number(r.visitors)} 位浏览器访客  ·  ${number(r.ips)} 个 IP`;
    if(tip)instances.get('analytics-chart')?.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:selected});
  }
  function traffic(data,p){
    series=period(data);
    $('analytics-trend-caption').textContent=(data.days===1?'今天按小时':'最近 '+data.days+' 天按天')+' · 页面访问 PV / 浏览器访客 UV / 独立 IP';
    if(!data.views){empty('analytics-chart',p);$('analytics-chart-detail').textContent='这个时间范围还没有访问记录';return;}
    const a=axes(p),zoom=series.length>14;
    const chart=plot('analytics-chart',{
      grid:{left:48,right:20,top:48,bottom:zoom?80:36},legend:{...base(p).legend,data:['页面访问 PV','浏览器访客 UV','独立 IP'],left:0,top:0},
      tooltip:{...base(p).tooltip,trigger:'axis',axisPointer:{type:chartType==='bar'?'shadow':'line'}},
      xAxis:{...a,type:'category',boundaryGap:chartType==='bar',data:series.map(r=>r.label),axisLabel:{...a.axisLabel,formatter:value=>data.days===1?value:value.slice(5),hideOverlap:true},splitLine:{show:false}},
      yAxis:{...a,type:'value',minInterval:1,axisLine:{show:false}},
      dataZoom:zoom?[{type:'inside',start:0,end:100},{type:'slider',height:18,bottom:14,borderColor:p.line,textStyle:{color:p.muted},backgroundColor:p.inset,fillerColor:p.colors[0]+'22',handleSize:16,start:0,end:100}]:[],
      series:[['页面访问 PV','views'],['浏览器访客 UV','visitors'],['独立 IP','ips']].map(([name,key],i)=>({name,type:chartType,data:series.map(r=>r[key]),barMaxWidth:22,smooth:false,showSymbol:series.length<=7,symbolSize:6,lineStyle:{width:2.5,type:i===2?'dashed':'solid'},areaStyle:i===0&&chartType==='line'?{opacity:.1}:undefined,itemStyle:{borderRadius:chartType==='bar'?[3,3,0,0]:0}}))
    },p);
    chart.off('updateAxisPointer');chart.on('updateAxisPointer',event=>{const index=event.axesInfo?.[0]?.value;if(Number.isInteger(index))select(index);});
    chart.off('click');chart.on('click',event=>{if(Number.isInteger(event.dataIndex))select(event.dataIndex,true);});
    select(data.days===1?new Date(Date.now()+8*3600000).getUTCHours():series.length-1);
  }
  function bars(key,data,p){
    const rows=(data.top[key]||[]).slice(0,8),id='analytics-'+key+'-chart';
    const sum=rows.reduce((n,r)=>n+r.count,0);
    $('analytics-'+key+'-note').textContent=data.views?`前 ${rows.length} 项 · ${number(sum)} 次访问，占全部 ${(sum/data.views*100).toFixed(1)}%`:'收到访问后会展示排行';
    if(!rows.length){empty(id,p);return;}
    const names=rows.map(r=>key==='pages'?pageLabel(r.label):r.label),a=axes(p),max=Math.max(...rows.map(r=>r.count));
    const chart=plot(id,{grid:{left:8,right:48,top:12,bottom:12,containLabel:true},
      tooltip:{...base(p).tooltip,trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>{const r=rows[params[0].dataIndex];return `${names[params[0].dataIndex]}\n${number(r.count)} 次访问 · ${(r.count/Math.max(data.views,1)*100).toFixed(1)}%`;}},
      xAxis:{...a,type:'value',minInterval:1,show:false,max:Math.max(1,max*1.2)},
      yAxis:{...a,type:'category',inverse:true,data:names,axisLine:{show:false},axisLabel:{...a.axisLabel,width:Math.min(150,Math.max(72,$(id).clientWidth*.3)),overflow:'truncate',fontSize:12},splitLine:{show:false}},
      series:[{type:'bar',data:rows.map((r,i)=>({value:r.count,itemStyle:{color:p.colors[key==='regions'?1:key==='sources'?2:0],opacity:1-i*.055}})),barMaxWidth:18,showBackground:true,backgroundStyle:{color:p.inset,borderRadius:4},itemStyle:{borderRadius:4},label:{show:true,position:'right',color:p.text,fontFamily:p.font,fontSize:12,formatter:v=>number(v.value)}}]
    },p);
    chart.off('click');if(key==='pages')chart.on('click',event=>{const r=rows[event.dataIndex];if(r)onPage(r.label);});
  }
  function donut(key,data,p){
    const rows=(data.top[key]||[]).map(r=>({name:r.label,value:r.count})),count=rows.reduce((n,r)=>n+r.value,0);
    if(count<data.views)rows.push({name:'其他（未列出）',value:data.views-count});
    const legend=$('analytics-'+key+'-legend');
    legend.innerHTML=rows.map((r,i)=>`<li><span><i style="background:${p.colors[i%p.colors.length]}" aria-hidden="true"></i>${esc(r.name)}</span><strong>${number(r.value)}</strong><small>${(r.value/Math.max(data.views,1)*100).toFixed(1)}%</small></li>`).join('')||'<li class="analytics-legend-empty">暂无分类数据</li>';
    if(!rows.length){empty('analytics-'+key+'-chart',p);return;}
    plot('analytics-'+key+'-chart',{
      title:[{text:number(data.views),left:'center',top:'38%',textStyle:{fontFamily:p.font,color:p.text,fontSize:28,fontWeight:600}},{text:'页面访问',left:'center',top:'55%',textStyle:{fontFamily:p.font,color:p.muted,fontSize:11,fontWeight:'normal'}}],
      tooltip:{...base(p).tooltip,trigger:'item',formatter:info=>`${info.name}\n${number(info.value)} 次访问 · ${info.percent}%`},
      legend:{show:false},series:[{type:'pie',radius:['62%','82%'],center:['50%','50%'],data:rows,minAngle:1,padAngle:rows.length>1?2:0,itemStyle:{borderRadius:4,borderColor:p.surface,borderWidth:2},label:{show:false},emphasis:{scale:true,scaleSize:5,label:{show:false}},avoidLabelOverlap:true}]
    },p);
  }
  function hours(data,p){
    const rows=Array.from({length:24},(_,hour)=>({hour,views:(data.hours||[]).find(r=>r.hour===hour)?.views||0})),a=axes(p);
    if(!data.views){empty('analytics-hours-chart',p);$('analytics-hours-note').textContent='暂无访问时段数据';return;}
    plot('analytics-hours-chart',{grid:{left:40,right:12,top:16,bottom:32},
      tooltip:{...base(p).tooltip,trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>`${params[0].axisValue}:00–${String((Number(params[0].axisValue)+1)%24).padStart(2,'0')}:00\n${number(params[0].value)} 次访问`},
      xAxis:{...a,type:'category',data:rows.map(r=>String(r.hour).padStart(2,'0')),axisLabel:{...a.axisLabel,interval:3},splitLine:{show:false}},
      yAxis:{...a,type:'value',minInterval:1,axisLine:{show:false}},
      series:[{type:'bar',barMaxWidth:16,data:rows.map(r=>r.views),itemStyle:{color:p.colors[1],borderRadius:[3,3,0,0]},emphasis:{itemStyle:{color:p.colors[0]}}}]
    },p);
    const peak=rows.reduce((a,b)=>a.views>=b.views?a:b);
    $('analytics-hours-note').textContent=`最活跃时段 ${String(peak.hour).padStart(2,'0')}:00–${String(peak.hour+1).padStart(2,'0')}:00 · 累计 ${number(peak.views)} 次访问`;
  }
  function heatmap(data,p){
    if(!data.views){empty('analytics-heatmap-chart',p);$('analytics-heatmap-note').textContent='暂无热力分布数据';return;}
    const weekdays=['周一','周二','周三','周四','周五','周六','周日'],cells=[];
    for(let day=0;day<7;day++)for(let hour=0;hour<24;hour++)cells.push([hour,day,(data.heatmap||[]).find(r=>r.weekday===day&&r.hour===hour)?.views||0]);
    const max=Math.max(1,...cells.map(r=>r[2]));
    plot('analytics-heatmap-chart',{
      grid:{left:44,right:12,top:12,bottom:72},
      tooltip:{...base(p).tooltip,formatter:info=>`${weekdays[info.value[1]]} ${String(info.value[0]).padStart(2,'0')}:00\n${number(info.value[2])} 次访问`},
      xAxis:{type:'category',data:Array.from({length:24},(_,i)=>String(i).padStart(2,'0')),splitArea:{show:false},axisTick:{show:false},axisLine:{show:false},axisLabel:{color:p.muted,fontFamily:p.font,fontSize:11,interval:1}},
      yAxis:{type:'category',data:weekdays,inverse:true,axisTick:{show:false},axisLine:{show:false},axisLabel:{color:p.muted,fontFamily:p.font,fontSize:11}},
      visualMap:{min:0,max,calculable:false,orient:'horizontal',left:'center',bottom:0,itemWidth:10,itemHeight:160,text:['多','少'],textStyle:{color:p.muted,fontSize:11},inRange:{color:[p.inset,p.colors[0]+'88',p.colors[0]]}},
      series:[{type:'heatmap',data:cells,itemStyle:{borderColor:p.surface,borderWidth:3,borderRadius:3},emphasis:{itemStyle:{borderColor:p.colors[2],borderWidth:2}},label:{show:false}}]
    },p);
    const peak=cells.reduce((a,b)=>a[2]>=b[2]?a:b);
    $('analytics-heatmap-note').textContent=`最活跃：${weekdays[peak[1]]} ${String(peak[0]).padStart(2,'0')}:00 · ${number(peak[2])} 次访问。色阶表示所选范围累计次数。`;
  }
  function draw(){
    if(!runtime||!lastData)return;const p=palette();traffic(lastData,p);
    for(const key of ['pages','sources','regions'])bars(key,lastData,p);
    for(const key of ['devices','browsers','systems'])donut(key,lastData,p);
    hours(lastData,p);heatmap(lastData,p);
  }
  const observer=new ResizeObserver(entries=>{for(const entry of entries){if(entry.contentRect.width>0)instances.get(entry.target.id)?.resize();}});
  const themeObserver=new MutationObserver(()=>{if(lastData)draw();});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-font']});
  root.querySelectorAll('[data-chart-type]').forEach(button=>button.onclick=()=>{
    chartType=button.dataset.chartType;root.querySelectorAll('[data-chart-type]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(lastData&&runtime)traffic(lastData,palette());
  });
  $('analytics-chart').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();select(event.key==='Home'?0:event.key==='End'?series.length-1:selected+(event.key==='ArrowLeft'?-1:1),true);
  });
  window.addEventListener('pagehide',event=>{if(event.persisted)return;observer.disconnect();themeObserver.disconnect();for(const chart of instances.values())chart.dispose();instances.clear();});
  return {async render(data){lastData=data;runtime=await library();draw();},get size(){return instances.size;}};
};
