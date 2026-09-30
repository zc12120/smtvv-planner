'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const elements={phy:'物理',fir:'火炎',ice:'冰结',ele:'电击',for:'冲击',lig:'破魔',dar:'咒杀',alm:'万能',ail:'异常',rec:'回复',sup:'辅助',pas:'被动',spe:'特殊'};
const elementOrder=new Map(Object.keys(elements).map((element,index)=>[element,index]));
const colors={phy:'#e2a489',fir:'#ed877a',ice:'#82c5e8',ele:'#d7d884',for:'#87c694',lig:'#c9ccac',dar:'#bc9cd7',alm:'#a9bccc',ail:'#d7a788',rec:'#87d2c2',sup:'#94bcde',pas:'#d8c294'};
let catalog,dm={},sm={},state={target:'',skills:[],sources:{},level:150,slots:8,dlc:['Dagda','Konohana Sakuya'],locked:[],excluded:[],allowUncertain:false,prices:{},starting:null};
let activeElement='',slotToFill=null,lastResult=null,siteMaintenance=false;
const computation = new TaskController();
const dn=n=>dm[n]?.label||n, sn=n=>sm[n]?.label||n;
const icon=name=>GameSite.icon(name);
const demonUI=GameSite.demonUI;
const queryText=GameSite.normalizeSearch, matchesQuery=GameSite.matchesQuery, matchesSkillName=GameSite.matchesName;
let orderedSkills=[];
const localService=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
window.addEventListener('smtvv:portraits-ready',()=>demonUI.hydrate($('demon-table'),activeTab==='demons'));
function plannerError(message){$('error').textContent=message;$('generation-notice').textContent=message;$('generation-notice').hidden=!message;}
function computeStatus(message){for(const id of ['compute-status','route-status'])if($(id))$(id).textContent=message;}
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3000);}
function updateCommandContext(){
 const target=state.target?dn(state.target):'尚未选择目标';
 $('command-target').textContent=target+(state.target?' · '+state.skills.length+'/'+state.slots:'');
 $('command-target').classList.toggle('is-empty',!state.target);
 $('calculate-label').textContent=state.target?'生成路线':'选择目标';
}
function updateCalculateButton(){
 const canStart=!siteMaintenance||(currentPage?.complete&&Object.keys(currentPage.solutions).length>0);
 $('calculate').disabled=computation.busy||!state.target||!canStart;
 if(!computation.busy)$('calculate-label').textContent=siteMaintenance?(canStart?'查看已有路线':'维护中'):state.target?'生成路线':'选择目标';
}
function applySiteState(data){
 if(!data?.settings)return;
 const wasMaintenance=siteMaintenance;
 siteMaintenance=data.settings.maintenance===true;
 updateCalculateButton();
 if(siteMaintenance&&!computation.busy&&!currentPage?.complete)computeStatus('维护中 · 暂停创建新计算');
 else if(wasMaintenance&&!siteMaintenance&&!computation.busy&&!currentPage)computeStatus(state.target?'配置已保存 · 等待生成':'等待配置');
}
window.addEventListener('smtvv:site-state',event=>applySiteState(event.detail));
GameSite.siteState?.then(applySiteState);
let activeTab='planner',pendingTab=window.smtvvPendingTab||'';
let tabScroll={};
let plannerView='build',comparisonOpen=false;
const loadedLibraries=new Set();
function ensureLibrary(tab){
 if(loadedLibraries.has(tab))return;
 if(tab==='demons'){libraryCategories();demonTable();demonUI.hydrate($('demon-table'),true);}
 else if(tab==='skills'){libraryCategories();skillTable();}
 else if(tab==='essences')initEssenceTable();
 loadedLibraries.add(tab);
}
function publishCatalogStatus(){
 // The counts describe loaded data. Offscreen/lazy artwork must not add a
 // fixed three-second "loading" state after the planner is already usable.
 $('status').textContent=`${catalog.demons.length} 仲魔 / ${catalog.skills.length} 技能`;
}
function setPlannerView(view,remember=true){plannerView=view==='route'?'route':'build';$('planner-build').hidden=plannerView!=='build';$('planner-route').hidden=plannerView!=='route';document.querySelectorAll('[data-planner-view]').forEach(b=>{const selected=b.dataset.plannerView===plannerView;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});if(remember){restoreScroll=null;window.scrollTo({top:0,behavior:'instant'});persistDesktopState();}}
document.querySelectorAll('[data-planner-view]').forEach(b=>b.onclick=()=>setPlannerView(b.dataset.plannerView));$('edit-build').onclick=()=>setPlannerView('build');
document.querySelector('.view-tabs').addEventListener('keydown',event=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 event.preventDefault();const buttons=[...document.querySelectorAll('[data-planner-view]')],index=buttons.indexOf(document.activeElement);
 const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
 setPlannerView(buttons[next].dataset.plannerView);buttons[next].focus({preventScroll:true});
});

function activate(tab,updateURL=true){
 if(!['planner','demons','skills','essences'].includes(tab))tab='planner';
 if(!catalog){pendingTab=tab;return;}
 const previousTab=activeTab;if(updateURL)tabScroll[previousTab]=scrollY;
 if(previousTab!==tab){GameSite.catalogUI.release(previousTab);loadedLibraries.delete(previousTab);}
 activeTab=tab;document.body.dataset.page=tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!=='tab-'+tab);
 ensureLibrary(tab);
 const title=GameSite.tabs[tab];document.querySelector('h1').textContent=title;$('page-section').textContent=title;document.title=tab==='planner'?'真女5复仇':title+' · 真女5复仇';
 if($('page-roman'))$('page-roman').textContent={planner:'DEMON FUSION',demons:'DEMON COMPENDIUM',skills:'SKILL ARCHIVE',essences:'ESSENCE ARCHIVE'}[tab];
 if(updateURL){const url=new URL(location.href);url.searchParams.set('tab',tab);url.searchParams.delete('q');url.hash='';if(previousTab!==tab)history.pushState(null,'',url);else history.replaceState(null,'',url);requestAnimationFrame(()=>{window.scrollTo(0,tabScroll[tab]||0);persistDesktopState();});}
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();activate(b.dataset.tab);});
document.querySelector('.site-brand').addEventListener('click',event=>{
 if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!catalog)return;
 event.preventDefault();activate('planner');setPlannerView('build');
 $('build-tab').focus({preventScroll:true});
});
function save(){try{localStorage.setItem('smtvv-config-v1',JSON.stringify(state));}catch{}if(new URLSearchParams(location.hash.slice(1)).has('config')){const url=new URL(location.href);url.hash='';history.replaceState(null,'',url);}}
function configKey(){return JSON.stringify([state.target,state.skills,Object.entries(state.sources).sort(),state.level,state.slots,[...state.dlc].sort(),[...state.locked].sort(),[...state.excluded].sort(),state.allowUncertain,Object.entries(state.prices).sort(),state.starting?[...state.starting].sort():null]);}
function nameList(text){return text.split('\n').map(s=>s.trim()).filter(Boolean).map(n=>{const d=catalog.demons.find(d=>d.name.toLowerCase()===n.toLowerCase()||d.label===n);if(!d)throw Error('无法识别仲魔名称：'+n);return d.name;});}
const pickerLabels={locked:'未解锁仲魔',excluded:'不想使用的仲魔',starting:'起始仲魔',prices:'需要修改召唤价的仲魔'};
function pickedNames(key){return key==='prices'?Object.keys(state.prices||{}):state[key]||[];}
function renderPicked(key){const names=pickedNames(key),box=$(key+'-selected');box.innerHTML=key==='prices'?names.map(n=>`<div class="price-entry"><span>${esc(dn(n))}</span><input type="number" min="0" max="100000000" value="${state.prices[n]}" data-price="${esc(n)}" aria-label="${esc(dn(n))}的召唤价"><small>魔货</small><button type="button" data-remove-picker="${esc(n)}" aria-label="移除${esc(dn(n))}的价格">×</button></div>`).join(''):names.map(n=>`<span class="picked-demon">${esc(dn(n))}<button type="button" data-remove-picker="${esc(n)}" aria-label="移除${esc(dn(n))}">×</button></span>`).join('');box.querySelectorAll('[data-price]').forEach(input=>input.addEventListener('change',onSettings));}
function pickerResults(key){const input=$(key+'-search'),q=input.value.trim().toLowerCase(),picked=pickedNames(key);const matches=catalog.demons.filter(d=>!picked.includes(d.name)&&`${d.label} ${d.name} ${d.raceLabel} ${d.searchAliases||''}`.toLowerCase().includes(q));const box=$(key+'-options');box.hidden=false;input.setAttribute('aria-expanded','true');box.innerHTML=matches.length?matches.slice(0,40).map(d=>`<button type="button" role="option" aria-selected="false" data-pick="${esc(d.name)}">${demonUI.identity(d.name,`<strong>${esc(d.label)}</strong><small>Lv.${d.level} · ${esc(d.raceLabel)} · ${esc(d.name)}</small>`)}</button>`).join('')+(matches.length>40?'<div class="picker-hint">输入名称可查找更多仲魔</div>':''):'<div class="picker-hint">没有匹配的仲魔</div>';}
function closePicker(key){$(key+'-options').hidden=true;$(key+'-search').setAttribute('aria-expanded','false');}
function updatePicked(key,name,remove=false){if(key==='prices'){if(remove)delete state.prices[name];else state.prices[name]=dm[name].basePrice;}else{const names=pickedNames(key).filter(n=>n!==name);if(!remove)names.push(name);state[key]=key==='starting'&&!names.length?null:names;}renderPicked(key);$(key+'-search').value='';closePicker(key);settingsSummary();renderSlots();changed();}
function initPickers(){for(const [key,title]of Object.entries(pickerLabels)){$(key+'-picker').className='demon-picker';$(key+'-picker').innerHTML=`<input id="${key}-search" role="combobox" aria-label="搜索${title}" aria-controls="${key}-options" aria-expanded="false" aria-autocomplete="list" placeholder="搜索并选择仲魔…" autocomplete="off"><div id="${key}-options" class="picker-options" role="listbox" aria-label="${title}搜索结果" hidden></div><div id="${key}-selected" class="picked-list"></div>`;const input=$(key+'-search');GameSite.bindSearch(input,()=>pickerResults(key));input.onfocus=()=>pickerResults(key);input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Escape')closePicker(key);if(e.key==='ArrowDown'){e.preventDefault();pickerResults(key);$(key+'-options').querySelector('[data-pick]')?.focus();}if(e.key==='Enter'){e.preventDefault();const exact=catalog.demons.find(d=>d.name.toLowerCase()===input.value.trim().toLowerCase()||d.label===input.value.trim());if(exact&&!pickedNames(key).includes(exact.name))updatePicked(key,exact.name);else{const items=$(key+'-options').querySelectorAll('[data-pick]');if(items.length===1)updatePicked(key,items[0].dataset.pick);}}};$(key+'-options').onclick=e=>{const b=e.target.closest('[data-pick]');if(b){updatePicked(key,b.dataset.pick);input.focus();closePicker(key);}};$(key+'-options').onkeydown=e=>{const items=[...$(key+'-options').querySelectorAll('[data-pick]')],i=items.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}if(e.key==='Escape'){input.focus();closePicker(key);}};$(key+'-selected').onclick=e=>{const b=e.target.closest('[data-remove-picker]');if(b)updatePicked(key,b.dataset.removePicker,true);};}document.addEventListener('pointerdown',e=>{for(const key of Object.keys(pickerLabels))if(!$(key+'-picker').contains(e.target))closePicker(key);});}
function readPrices(){const result={};document.querySelectorAll('[data-price]').forEach(input=>{const price=Number(input.value);if(input.value.trim()===''||!Number.isSafeInteger(price)||price<0||price>100000000)throw Error(dn(input.dataset.price)+'的召唤价须为非负整数');result[input.dataset.price]=price;});return result;}
function readSettings(){const level=Number($('level').value),slots=Number($('slots').value);if(!Number.isInteger(level)||level<1||level>150)throw Error('最高等级须为 1–150 的整数。');return {level,slots,prices:readPrices(),starting:state.starting?[...state.starting]:null,dlc:[...document.querySelectorAll('[data-dlc]:checked')].map(e=>e.dataset.dlc),locked:[...state.locked],excluded:[...state.excluded],allowUncertain:$('uncertain').checked};}
function settingsToUI(){$('uncertain').checked=state.allowUncertain;document.querySelectorAll('[data-dlc]').forEach(e=>{e.checked=state.dlc.includes(e.dataset.dlc);});for(const id of ['level','slots'])$(id).value=state[id];for(const key of Object.keys(pickerLabels))renderPicked(key);settingsSummary();}
function settingsSummary(){$('settings-summary').textContent=`Lv.${state.level} · ${state.slots} 栏位${state.locked.length+state.excluded.length?' · 限制 '+(state.locked.length+state.excluded.length)+' 项':''}${state.starting!==null?' · 限定材料':''}${Object.keys(state.prices).length?' · 自定义价格':''}${state.dlc.length<2?' · DLC '+state.dlc.length+'/2':''}${Object.keys(state.sources).length?' · 指定来源 '+Object.keys(state.sources).length:''}${state.allowUncertain?' · 含待核实配方':''}`;const restricted=state.locked.length+state.excluded.length,materials=(state.starting?.length||0)+Object.keys(state.prices||{}).length;$('restriction-count').textContent=restricted?`已设 ${restricted} 只`:'未限制';$('material-count').textContent=materials?`已设 ${materials} 项`:'默认';}
function onSettings(){if(!catalog)return;try{const updated=readSettings();if(Object.keys(updated).every(k=>JSON.stringify(state[k])===JSON.stringify(updated[k])))return;Object.assign(state,updated);settingsSummary();renderSlots();changed();}catch(e){changed();plannerError(e.message);computeStatus('请检查合体条件');}}
for(const id of ['level','slots','uncertain'])$(id).addEventListener('change',onSettings);
function unavailable(n,learnLevel){const d=dm[n];return !d||(d.dlc&&!state.dlc.includes(n))||state.locked.includes(n)||state.excluded.includes(n)||d.level>state.level||(learnLevel||0)>state.level;}
function searchDemons(){if(!catalog)return;const q=queryText($('target-search').value),race=$('race').value;const all=catalog.demons.filter(d=>(!race||d.race===race)&&matchesQuery(d,q));const show=!!q||!!race;$('target-results').hidden=!show;$('target-search').setAttribute('aria-expanded',String(show));if(show)$('target-results').innerHTML=all.length?all.map(d=>`<button class="demon-option" role="option" aria-selected="${state.target===d.name}" data-demon="${esc(d.name)}">${demonUI.identity(d.name,`<strong>${esc(d.label)}</strong><small>Lv.${d.level} · ${esc(d.raceLabel)} · ${esc(d.name)}${d.dlc?' · DLC':''}</small>`)}</button>`).join(''):'<p class="muted">没有匹配的仲魔</p>';}
GameSite.bindSearch($('target-search'),searchDemons);$('race').onchange=searchDemons;
$('target-results').onclick=e=>{const b=e.target.closest('[data-demon]');if(b)chooseTarget(b.dataset.demon);};
$('target-search').onkeydown=e=>{if(e.isComposing)return;if(e.key==='Escape')closeTargets();if(e.key==='ArrowDown'){e.preventDefault();searchDemons();$('target-results').querySelector('[data-demon]')?.focus();}if(e.key==='Enter'&&!$('target-results').hidden){e.preventDefault();const options=$('target-results').querySelectorAll('[data-demon]');if(options.length===1)chooseTarget(options[0].dataset.demon);}};
function closeTargets(){$('target-results').hidden=true;$('target-search').setAttribute('aria-expanded','false');}
$('target-results').onkeydown=e=>{const options=[...$('target-results').querySelectorAll('[data-demon]')],i=options.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();options[(i+(e.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();}if(e.key==='Escape'){$('target-search').focus();closeTargets();}};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.target-panel'))closeTargets();});
function chooseTarget(name,seed=true){if(!dm[name])return;state.target=name;if(seed&&!state.skills.length){state.skills=Object.entries(dm[name].skills).filter(([s,l])=>l<1&&sm[s]).map(([s])=>s).slice(0,state.slots);state.sources={};}const removed=state.skills.filter(n=>sm[n]?.unique&&!(n in dm[name].skills));state.skills=state.skills.filter(n=>!removed.includes(n));for(const n of removed)delete state.sources[n];if(removed.length)toast('已移除新目标无法继承的专属技能：'+removed.map(sn).join('、'));$('target-search').value='';closeTargets();renderTarget();renderSlots();changed();}
function renderTarget(){
 const d=dm[state.target];$('build-summary').innerHTML=d?`<strong>${esc(d.label)}</strong><span>Lv.${d.level} · ${state.skills.length} 个技能</span>`:'';
 $('configuration').dataset.targetSelected=String(!!d);
 $('change-target').hidden=!d;document.querySelector('.target-panel .search-row').hidden=!!d&&GameSite.compact.matches;
 if($('loadout-guidance'))$('loadout-guidance').hidden=!!d;
 updateCommandContext();
 if(!d){
  $('target-card').className='empty-target';
  $('target-card').innerHTML=`<div class="empty-target-intro"><span aria-hidden="true">QUICK START</span><h3>从一位仲魔开始</h3></div><div id="quick-targets">${['Alice','Pixie','Yoshitsune','Agrat'].filter(n=>dm[n]).map(n=>`<button data-quick="${esc(n)}" aria-label="选择${esc(dn(n))}">${demonUI.image(n,'hero','lazy')}<span class="quick-target-copy"><strong>${esc(dn(n))}</strong><small>${esc(dm[n].raceLabel)} · Lv.${dm[n].level}</small></span>${icon('ArrowUpRight')}</button>`).join('')}</div>`;
  return;
 }
 const method=d.accident?'合体事故':d.special.length?'特殊合体':'普通合体';
 const badge=d.accident?'tag-warning':d.special.length?'tag-special':'tag-normal';
 $('target-card').className='target-card';
 $('target-card').innerHTML=`
  <div class="target-overview">
   <div class="target-portrait"><span class="portrait-level" aria-hidden="true"><small>LV.</small>${d.level}</span>${demonUI.image(d.name,'hero','eager')}</div>
   <div class="target-head"><div><span class="target-race">${esc(d.raceLabel)}<span>Lv.${d.level}</span></span><h3>${entryLink('demon',d.name,d.label)}</h3><p>${esc(d.name)}</p></div><div class="target-badges"><span class="tag ${badge}">${method}</span>${d.dlc?'<span class="tag tag-special">DLC</span>':''}</div></div>
  </div>
  <details class="target-details" data-desktop-open ${GameSite.compact.matches?'':'open'}><summary>抗性与习得技能 ${icon('ChevronDown')}</summary>
  ${GameSite.skillUI.resists(d)}${GameSite.skillUI.innate(d,'planner')}${demonUI.profile(d,'compact')}
  <div class="native-heading"><h4>习得技能</h4><span>${Object.keys(d.skills).length}</span></div>
  <div class="native-skills">${Object.entries(d.skills).filter(([s])=>sm[s]).map(([s,l])=>`<div class="native-skill-row">${skillLink(s,sn(s))}<small>${l<1?'初始':'Lv.'+l}</small><button class="quiet icon-button" data-native="${esc(s)}" aria-label="加入${esc(sn(s))}" data-tooltip="${state.skills.includes(s)?'已加入配置':'加入技能配置'}" ${state.skills.includes(s)?'disabled':''}>${icon(state.skills.includes(s)?'Check':'Plus')}</button></div>`).join('')}</div>
  ${d.unlock?`<details class="target-unlock"><summary>${icon('LockKeyhole')}解锁条件</summary><p>${esc(d.unlock)}</p></details>`:''}</details>`;
}
$('change-target').onclick=()=>{const row=document.querySelector('.target-panel .search-row');row.hidden=!row.hidden;if(!row.hidden)$('target-search').focus();};
$('add-skill').onclick=()=>openSkills(state.skills.length);
$('target-card').onclick=e=>{const q=e.target.closest('[data-quick]'),n=e.target.closest('[data-native]');if(q)chooseTarget(q.dataset.quick);if(n){slotToFill=null;addSkill(n.dataset.native);};};
function renderSlots(){
 settingsSummary();
 $('add-skill').disabled=!state.target||state.skills.length>=state.slots;
 $('add-skill-count').textContent=state.skills.length+' / '+state.slots;
 $('skill-count').textContent=`${state.skills.length} / ${state.slots}`;
 if($('skill-capacity'))$('skill-capacity').innerHTML=Array.from({length:8},(_,i)=>`<i class="capacity-tick ${i<state.skills.length?'is-filled':''} ${i>=state.slots?'is-locked':''}"></i>`).join('');
 $('skill-slots').innerHTML=Array.from({length:8},(_,i)=>{
 const name=state.skills[i],number=String(i+1).padStart(2,'0');
 if(!name)return `<button type="button" class="slot-empty" data-slot="${i}" data-locked="${i>=state.slots}" aria-label="第 ${i+1} 栏：${i>=state.slots?'尚未解锁':!state.target?'请先选择目标仲魔':'添加技能'}" ${!state.target||i>=state.slots?'disabled':''}><span class="slot-order">${number}</span>${icon(i>=state.slots?'LockKeyhole':'Plus')}<span>${i>=state.slots?'尚未解锁':'添加技能'}</span></button>`;
 const skill=sm[name];if(!skill)return '';
 return `<div class="skill-slot filled ${skill.unique?'is-unique':''} ${i>=state.slots?'is-over-capacity':''}" data-element="${esc(skill.element)}"><div class="slot-head"><span class="slot-order">${number}</span><span class="slot-cost" title="${esc(skill.costZh||'')}">${esc(skill.element==='pas'?'被动':skill.costZh||'—')}</span><button class="slot-replace icon-button" data-replace="${i}" aria-label="替换 ${esc(skill.label)}" data-tooltip="替换技能">${icon('ArrowLeftRight')}</button><button class="slot-remove icon-button" data-remove="${i}" aria-label="移除 ${esc(skill.label)}" data-tooltip="移除技能">${icon('X')}</button>${skillLink(name,skill.label)}</div><details class="slot-detail" data-desktop-open ${GameSite.compact.matches?'':'open'}><summary><span>${esc(skill.effectZh||'查看技能详情')}</span>${icon('ChevronDown')}</summary><p class="slot-effect">${esc(skill.effectZh||'')}</p><div class="slot-bottom">${skill.unique?'<span class="source-fixed"><span class="tag tag-special">专属</span>目标自身习得</span>':`<button type="button" class="source-picker-button" data-choose-source="${esc(name)}" aria-label="${esc(skill.label)}的来源仲魔">${icon('GitBranch')}<span>${state.sources[name]?esc(dn(state.sources[name])):'自动选择来源'}</span>${icon('ChevronDown')}</button>`}</div></details></div>`;
 }).join('');updateCommandContext();if(dm[state.target])$('build-summary').innerHTML=`<strong>${esc(dn(state.target))}</strong><span>Lv.${dm[state.target].level} · ${state.skills.length} 个技能</span>`;
}
let sourceSkill='';
function renderSourceOptions(){const skill=sm[sourceSkill];if(!skill)return;const q=$('source-search').value.trim().toLowerCase(),chosen=state.sources[sourceSkill]||'';const rows=[...skill.sources].sort((a,b)=>a.level-b.level).filter(o=>`${dn(o.name)} ${o.name} ${dm[o.name]?.raceLabel||''}`.toLowerCase().includes(q));$('source-options').innerHTML=`<button type="button" class="source-option automatic ${chosen?'':'chosen'}" data-set-source=""><div><strong>自动匹配来源</strong><small>由路线计算选择合适的仲魔</small></div><span>${chosen?'':'✓'}</span></button>`+rows.map(o=>`<button type="button" class="source-option ${chosen===o.name?'chosen':''}" data-set-source="${esc(o.name)}" ${unavailable(o.name,o.level)?'disabled':''}>${demonUI.identity(o.name,`<strong>${esc(dn(o.name))}</strong><small>${esc(dm[o.name]?.raceLabel||'')} · ${esc(o.name)}</small>`)}<span>Lv.${o.level}${unavailable(o.name,o.level)?' · 受条件限制':chosen===o.name?' ✓':''}</span></button>`).join('')+(rows.length?'':'<p class="muted">没有匹配的仲魔</p>');}
function openSource(name){sourceSkill=name;$('source-title').innerHTML=GameSite.skillUI.label(name,sn(name))+'<span>选择来源</span>';$('source-search').value='';renderSourceOptions();$('source-dialog').showModal();$('source-search').focus();}
GameSite.bindSearch($('source-search'),renderSourceOptions);$('close-source').onclick=()=>$('source-dialog').close();$('source-options').onclick=e=>{const b=e.target.closest('[data-set-source]');if(!b||b.disabled)return;if(b.dataset.setSource)state.sources[sourceSkill]=b.dataset.setSource;else delete state.sources[sourceSkill];$('source-dialog').close();renderSlots();changed();};
$('skill-slots').onclick=e=>{const replace=e.target.closest('[data-replace]');if(replace){openSkills(Number(replace.dataset.replace));return;}const source=e.target.closest('[data-choose-source]');if(source){openSource(source.dataset.chooseSource);return;}const remove=e.target.closest('[data-remove]'),empty=e.target.closest('[data-slot]');if(remove){const [s]=state.skills.splice(Number(remove.dataset.remove),1);delete state.sources[s];renderSlots();renderTarget();changed();}if(empty)openSkills(Number(empty.dataset.slot));};
$('skill-slots').onchange=e=>{if(e.target.dataset.source){const s=e.target.dataset.source;if(e.target.value)state.sources[s]=e.target.value;else delete state.sources[s];changed();}};
function openSkills(i){if(!state.target){toast('请先选择目标仲魔');$('target-search').focus();return;}slotToFill=i;activeElement='';$('skill-search').value='';renderElements();renderSkillOptions();$('skill-dialog').showModal();$('skill-search').focus();}
function renderElements(){$('elements').innerHTML=[['','全部'],...Object.entries(elements)].map(([key,label])=>`<button type="button" data-element="${key}" aria-pressed="${activeElement===key}" class="${activeElement===key?'active':''}">${key?GameSite.skillUI.symbol(key):''}${label}</button>`).join('');}
$('elements').onclick=e=>{
 const button=e.target.closest('button[data-element]');
 if(!button||button.disabled)return;
 activeElement=button.dataset.element;
 $('elements').querySelectorAll('button[data-element]').forEach(item=>{const selected=item.dataset.element===activeElement;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});
 renderSkillOptions();
};
function renderSkillOptions(){
 const q=queryText($('skill-search').value),list=orderedSkills.filter(s=>(!activeElement||s.element===activeElement)&&matchesSkillName(s,q)&&(!s.unique||s.name in(dm[state.target]?.skills||{})));
 $('skill-options').innerHTML=list.length?list.map(s=>`<button type="button" class="skill-option" data-add="${esc(s.name)}" ${state.skills.includes(s.name)?'disabled':''}><span class="option-skill-title">${GameSite.skillUI.label(s.name,s.label)}<small>${esc(s.costZh||'')}</small></span><span class="picker-effect">${esc(s.effectZh||'')}</span><span class="option-skill-meta">${s.unique?'目标专属':s.sources.length+' 个来源'}<span>${state.skills.includes(s.name)?icon('Check'):icon('Plus')}</span></span></button>`).join(''):'<p class="empty-state">没有符合当前继承条件的技能。</p>';
}
GameSite.bindSearch($('skill-search'),renderSkillOptions);$('close-dialog').onclick=()=>$('skill-dialog').close();$('skill-dialog').onclick=e=>{if(e.target===$('skill-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
$('skill-options').onclick=e=>{const b=e.target.closest('[data-add]');if(b){addSkill(b.dataset.add);$('skill-dialog').close();}};
function addSkill(s){if(state.skills.includes(s))return;if(state.skills.length>=state.slots&&!(slotToFill!==null&&slotToFill<state.skills.length)){toast('技能栏位已满，请先移除一个技能');return;}if(slotToFill!==null&&slotToFill<state.skills.length){delete state.sources[state.skills[slotToFill]];state.skills[slotToFill]=s;}else state.skills.push(s);slotToFill=null;renderSlots();renderTarget();changed();}
$('clear-skills').onclick=()=>{state.skills=[];state.sources={};renderSlots();renderTarget();changed();};
$('example').onclick=()=>{state.target='Alice';state.skills=['Die For Me!','Megidolaon','Enduring Soul'];state.sources={};renderTarget();renderSlots();changed();};

var currentPage=null,selectedObjective='',renderedSignature='';
window.currentPage = currentPage;
function setCurrentPage(value){currentPage=value;window.currentPage=value;}
function setComputing(value){
 if(value&&!computation.busy)computation.transition('running');else if(!value&&computation.busy)computation.transition('idle');$('cancel-compute').hidden=!value;$('route-cancel').hidden=!value;updateCalculateButton();
 if(value){$('retry-compute').hidden=true;$('calculate-label').textContent='正在计算…';}
}
function cancelJob(jobId){if(jobId)api('optimal/cancel',{jobId},{attempts:2}).catch(()=>{});}
function stopComputation(){
 const jobId=computation.invalidate();
 setComputing(false);
 forgetActiveRequest();
 cancelJob(jobId);
}
function changed(){
 stopComputation();computation.completed=null;previewSignature='';computation.retryObjective='mixed';selectedObjective='';renderedSignature='';lastResult=null;setCurrentPage(null);plannerError('');
 $('retry-compute').hidden=true;$('build-preview').hidden=true;$('route-ready').hidden=true;
 $('result').innerHTML=state.target?`<div class="empty-route">${icon('Route')}<p>选好技能后，点击“生成路线”开始计算。</p></div>`:'<div class="empty-route"><p>尚未生成路线</p></div>';
 computeStatus(siteMaintenance?'维护中 · 暂停创建新计算':state.target?'配置已保存 · 等待生成':'等待配置');updateCommandContext();updateCalculateButton();save();
}
function api(path,data,options={}) {
 return SmtvvCommon.requestJson('/api/'+path,{data,attempts:3,label:'计算服务',onResponse:response=>{if(response.status===401)GameSite.requireLogin();},...options});
}
function requestOptions(current){return {signal:computation.abort.signal,isCurrent:()=>current===computation.revision,onRetry:(attempt,error)=>{computeStatus(error.status===429||error.status===503?`计算服务繁忙，${Math.ceil(error.delay/1000)} 秒后重试（${attempt}/2）…`:`连接中断，正在重试（${attempt}/2）…`);}};}
function computationFailed(error,current){
 if(current!==computation.revision)return;
 computation.transition('failed');
 computation.retryObjective=computation.request?.objective||computation.retryObjective;
 if(!error.retryable&&error.status!==401){computation.jobId='';computation.request=null;forgetActiveRequest();}
 plannerError(error.message);setComputing(false);$('retry-compute').hidden=false;$('calculate-label').textContent='重试计算';
 if(error.status===401){$('retry-compute').hidden=true;$('calculate').disabled=true;}
 computeStatus(error.status===401?'登录已过期 · 请重新登录':error.retryable?'连接异常 · 可重试':'计算未完成 · 请检查配置');
 if(computation.completed){setCurrentPage(computation.completed);renderedSignature='';renderOptimal(currentPage);}
 if(!currentPage)$('result').innerHTML='<div class="empty-route"><p>计算暂未完成，配置已保留。</p></div>';
}
async function startCalculation(payload,current){
 try{
  const r=await api('optimal/start',payload,requestOptions(current));
  if(current!==computation.revision){cancelJob(r.jobId);return;}
  if(typeof r.jobId!=='string'||!r.jobId)throw Object.assign(Error('计算服务未返回任务编号，请重试。'),{retryable:true});
  computation.jobId=r.jobId;rememberActiveRequest();pollRoutes(current);
 }catch(e){if(current!==computation.revision)cancelJob(payload.requestId);else computationFailed(e,current);}
}
function compute(objective='mixed',preserve=false){
 if(!catalog||!state.target||computation.busy||siteMaintenance)return;
 plannerError('');let payload;
 try{
  Object.assign(state,readSettings());payload=JSON.parse(JSON.stringify(state));delete payload.maxSteps;
  if(state.skills.length>state.slots)throw Error('所选技能超过当前可用栏位，请移除多余技能。');
 }catch(e){plannerError(e.message);computeStatus('请检查合体条件');setComputing(false);return;}
 stopComputation();const current=computation.revision;
 if(!preserve){computation.completed=null;setCurrentPage(null);lastResult=null;}
 selectedObjective=objective;computation.retryObjective=objective;renderedSignature='';save();
 // The same ID is reused if a start response is lost, so retrying cannot launch another search.
 payload.objective=objective;payload.requestId=crypto.randomUUID();computation.request=payload;computation.transition('submitting');rememberActiveRequest();
 if(!preserve)try{sessionStorage.removeItem('smtvv-computed-routes-v1');}catch{}
 showRouteStatus({solutions:{},computedObjectives:[],objective,finished:false,complete:false,stage:'排队等待计算',seconds:0,priceMode:computation.completed?.priceMode||'baseline'});
 startCalculation(payload,current);
}
function showRouteStatus(r){
 computation.receive(r);
 r={...r,resultId:SmtvvCommon.fingerprint([computation.completed?.resultId||'',resultSignature(r)]),solutions:{...computation.completed?.solutions,...r.solutions},computedObjectives:[...new Set([...(computation.completed?.computedObjectives||[]),...(r.computedObjectives||Object.keys(r.solutions))])]};
 setCurrentPage(r);if(r.finished&&r.complete)computation.completed=r;
 const count=Object.keys(r.solutions).length;
 $('route-ready').hidden=!r.complete||!count;$('route-ready').textContent=count;setComputing(!r.finished);renderOptimal(r);
 $('calculate-label').textContent=r.complete&&count?'查看路线':r.finished?'重新计算':'正在计算…';
 computeStatus(r.finished?(r.complete?(count?`${count} 种方案已就绪`:'当前条件下没有可行路线'):r.message):`${r.stage} · ${r.seconds} 秒`);
}
function forgetActiveRequest(){try{sessionStorage.removeItem('smtvv-active-request-v1');}catch{}}
function rememberActiveRequest(){
 if(!computation.request)return;
 try{sessionStorage.setItem('smtvv-active-request-v1',JSON.stringify({config:configKey(),version:catalog.version,source:catalog.source,requestId:computation.request.requestId,jobId:computation.jobId,objective:computation.request.objective}));}catch{}
}
function readActiveRequest(){try{return JSON.parse(sessionStorage.getItem('smtvv-active-request-v1'));}catch{return null;}}
function restoreActiveRequest(saved){
 if(!saved||saved.config!==configKey()||saved.version!==catalog.version||saved.source!==catalog.source||typeof saved.requestId!=='string'||!saved.requestId||saved.requestId.length>80){
  if(typeof saved?.requestId==='string')cancelJob(saved.requestId);
  return false;
 }
 computation.request={...JSON.parse(JSON.stringify(state)),requestId:saved.requestId,objective:routeDefinitions.some(([id])=>id===saved.objective)?saved.objective:'mixed'};
 selectedObjective=computation.request.objective;computation.retryObjective=computation.request.objective;
 computation.jobId=typeof saved.jobId==='string'?saved.jobId:'';
 rememberActiveRequest();showRouteStatus({solutions:{},computedObjectives:[],objective:computation.request.objective,finished:false,complete:false,stage:'正在恢复上次计算…',seconds:0,priceMode:computation.completed?.priceMode||'baseline'});
 if(computation.jobId)pollRoutes(computation.revision);else startCalculation(computation.request,computation.revision);
 return true;
}
function rememberRoutes(r){try{sessionStorage.setItem('smtvv-computed-routes-v1',JSON.stringify({config:configKey(),version:catalog.version,source:catalog.source,result:r}));}catch{}}
function restoreRoutes(){
 try{
  const saved=JSON.parse(sessionStorage.getItem('smtvv-computed-routes-v1'));
  if(saved?.config!==configKey()||saved.version!==catalog.version||saved.source!==catalog.source||!saved.result?.complete||!saved.result.finished||saved.result.error)return false;
  showRouteStatus(saved.result);return true;
 }catch{return false;}
}
async function pollRoutes(current){
 const token=++computation.pageRevision;
 try{
  const r=await api('optimal/status',{jobId:computation.jobId},requestOptions(current));
  if(current!==computation.revision||token!==computation.pageRevision)return;
  if(r.error)throw Error(r.error);
  plannerError('');showRouteStatus(r);
  if(!r.finished)computation.pollTimer=setTimeout(()=>pollRoutes(current),document.hidden?1000:r.seconds<1?100:r.seconds<3?250:500);
  else if(r.complete){rememberRoutes(currentPage);computation.jobId='';computation.request=null;forgetActiveRequest();}
  else{computation.jobId='';computation.request=null;forgetActiveRequest();$('retry-compute').hidden=false;}
 }catch(e){if(token===computation.pageRevision)computationFailed(e,current);}
}
function retryComputation(){
 if(computation.busy)return;
 if(!computation.request){compute(computation.retryObjective,!!computation.completed);return;}
 plannerError('');showRouteStatus({solutions:{},computedObjectives:[],objective:computation.request.objective,finished:false,complete:false,stage:'正在恢复计算…',seconds:0,priceMode:computation.completed?.priceMode||'baseline'});
 if(computation.jobId)pollRoutes(computation.revision);else startCalculation(computation.request,computation.revision);
}
$('calculate').onclick=()=>{setPlannerView('route');if(!currentPage?.complete||!Object.keys(currentPage.solutions).length)retryComputation();};
$('retry-compute').onclick=retryComputation;
function cancelComputation(){
 stopComputation();renderedSignature='';plannerError('');
 if(computation.completed){
  selectedObjective=computation.completed.solutions.mixed?'mixed':Object.keys(computation.completed.solutions)[0]||'mixed';
  showRouteStatus(computation.completed);rememberRoutes(computation.completed);$('retry-compute').hidden=true;return;
 }
 setCurrentPage(null);lastResult=null;
 $('build-preview').hidden=true;$('route-ready').hidden=true;$('retry-compute').hidden=true;updateCommandContext();
 computeStatus('已取消计算');$('result').innerHTML='<div class="empty-route"><p>计算已取消，可修改配置后重新生成。</p></div>';
}
$('cancel-compute').onclick=cancelComputation;$('route-cancel').onclick=cancelComputation;
const money=n=>Number(n).toLocaleString(SmtvvI18n.locale)+' 魔货';
const routeDefinitions=[['mixed','综合最优','GitMerge','合体＋灵体 · 优先总操作'],['shortest','合体次数最少','Route','纯合体 · 优先合体次数'],['cheapest','费用最低','Coins','纯合体 · 优先材料费']];
function chooseObjective(key,open=false){
 if(!routeDefinitions.some(([id])=>id===key))return;
 if(!currentPage?.computedObjectives?.includes(key)&&!currentPage?.solutions[key]){
  if(computation.busy||siteMaintenance)return;
  comparisonOpen=false;compute(key,true);if(open)setPlannerView('route');return;
 }
 selectedObjective=key;comparisonOpen=false;renderedSignature='';renderOptimal(currentPage);
 if(open)setPlannerView('route');
 persistDesktopState();
}
let previewSignature='';
const resultSignature=r=>r.resultId||SmtvvCommon.fingerprint(r.solutions);
function renderBuildPreview(r){
 const signature=JSON.stringify([resultSignature(r),r.finished,SmtvvI18n.locale]);if(previewSignature===signature)return;previewSignature=signature;
 const preview=$('build-preview');preview.hidden=!Object.keys(r.solutions).length;
 preview.innerHTML=`<div class="preview-heading"><h3>路线预览</h3><span>${r.finished?'计算完成':'计算中'}</span></div>`+routeDefinitions.map(([key,title,symbol])=>{
  const route=r.solutions[key];if(!route)return '';
  return `<button class="preview-route" data-preview="${key}"><span>${icon(symbol)}${title}</span><strong>${Number(route.totalCost).toLocaleString(SmtvvI18n.locale)}<small> 魔货</small></strong><span>${route.operationCount??route.stepCount} 步${icon('ArrowUpRight')}</span></button>`;
 }).join('');
 preview.querySelectorAll('[data-preview]').forEach(button=>button.onclick=()=>chooseObjective(button.dataset.preview,true));
}
function renderOptimal(r){
 renderBuildPreview(r);
 const key=selectedObjective||'mixed';
 const computed=new Set(r.computedObjectives||Object.keys(r.solutions));
 const pending=id=>computed.has(id)?'无可行路线':!r.finished&&r.objective===id?'正在计算…':'点击计算';
 const disabled=id=>!r.solutions[id]&&!computed.has(id)&&((computation.busy&&id!==r.objective)||siteMaintenance);
 const signature=JSON.stringify([key,resultSignature(r),SmtvvI18n.locale,r.computedObjectives,r.finished,r.priceMode,computation.busy,siteMaintenance]);if(signature===renderedSignature)return;renderedSignature=signature;
 const focusedObjective=document.activeElement?.closest('.strategy')?.dataset.optimal;
 $('result').innerHTML=`<label class="mobile-objective"><span>路线方案</span><select id="mobile-objective">${routeDefinitions.map(([id,title])=>`<option value="${id}" ${id===key?'selected':''} ${disabled(id)?'disabled':''}>${title}${r.solutions[id]?'':' · '+pending(id)}</option>`).join('')}</select></label><div class="strategy-strip" role="group" aria-label="优化方案">${routeDefinitions.map(([id,title,symbol,note])=>{
  const route=r.solutions[id];return `<button type="button" class="strategy ${key===id?'selected':''}" data-optimal="${id}" aria-pressed="${key===id}" aria-controls="route-detail" title="${esc(note)}" ${disabled(id)?'disabled':''}><span class="strategy-title">${icon(symbol)}<span class="strategy-label">${title}</span><span class="strategy-check">${icon(key===id?'CircleCheck':'Circle')}</span></span>${route?`<span class="strategy-metrics"><span class="strategy-price">${Number(route.totalCost).toLocaleString(SmtvvI18n.locale)}<small>魔货</small></span><span class="strategy-counts"><span>${route.fusionCount??route.stepCount} 合体</span><span>${route.essenceCount||0} 灵体</span><strong>${route.operationCount??route.stepCount} 步</strong></span></span>`:`<span class="strategy-pending">${pending(id)}</span>`}</button>`;
 }).join('')}</div><details id="route-choices" class="route-compare" ${comparisonOpen?'open':''}><summary>${icon('ChevronDown')}方案对比明细</summary><table class="route-comparison"><caption class="sr-only">合体路线对照，选择一种方案阅读步骤</caption><thead><tr><th scope="col">方案</th><th scope="col" class="numeric">材料费 / 魔货</th><th scope="col" class="numeric">合体次数</th><th scope="col" class="numeric">灵体授技</th><th scope="col" class="numeric">总操作</th></tr></thead><tbody>${routeDefinitions.map(([id,title,,note])=>{const route=r.solutions[id];return `<tr data-optimal="${id}" class="${route&&key===id?'selected':''}"><th scope="row"><button type="button" ${disabled(id)?'disabled':''} aria-pressed="${key===id}"><span class="choice-marker">${route&&key===id?'●':'○'}</span>${title}</button><small>${note}</small></th>${route?`<td class="numeric">${Number(route.totalCost).toLocaleString(SmtvvI18n.locale)}</td><td class="numeric">${route.fusionCount??route.stepCount}</td><td class="numeric">${route.essenceCount||0}</td><td class="numeric">${route.operationCount??route.stepCount}</td>`:`<td colspan="4" class="muted">${pending(id)}</td>`}</tr>`;}).join('')}</tbody></table></details><p class="result-price-note">${icon('Info')}材料费按${r.priceMode==='baseline'?'基准召唤价':'设定召唤价'}计算；综合方案默认拥有全部灵体且灵体免费。</p><div id="route-detail"></div>`;
 $('mobile-objective').onchange=e=>chooseObjective(e.target.value);
 $('route-choices').ontoggle=e=>{comparisonOpen=e.currentTarget.open;};
 if(r.solutions[key]){lastResult=r.solutions[key];renderRoute(lastResult,'route-detail');}
 else{lastResult=null;$('route-detail').innerHTML=`<div class="empty-route"><p>${computed.has(key)?'当前条件下该方案没有可行路线':!r.finished?'正在计算所选方案…':'点击方案即可计算'}</p></div>`;}
 document.querySelectorAll('[data-optimal]').forEach(button=>button.onclick=()=>{chooseObjective(button.dataset.optimal);document.querySelector(`[data-optimal="${selectedObjective}"]`)?.focus({preventScroll:true});});
 $('result').querySelector('.strategy-strip').onkeydown=event=>{
  const button=event.target.closest('.strategy');
  if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const options=[...event.currentTarget.querySelectorAll('.strategy:not(:disabled)')],index=options.indexOf(button);
  if(index<0)return;
  event.preventDefault();
  options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowRight'?1:-1)+options.length)%options.length].click();
 };
 if(focusedObjective)$('result').querySelector(`.strategy[data-optimal="${focusedObjective}"]`)?.focus({preventScroll:true});
 if(r.finished&&restoreScroll!==null){const y=restoreScroll;restoreScroll=null;requestAnimationFrame(()=>window.scrollTo(0,y));}
}
function entryLink(kind,name,label){return `<a href="/${kind}.html?name=${encodeURIComponent(name)}&from=${activeTab}">${esc(label)}</a>`;}
function skillLink(name,text,classes='skill-detail-link',from='planner'){return GameSite.skillUI.link(name,text,from,classes);}
function tags(skills){return skills.map(s=>skillLink(s,sn(s),'skill-tag')).join('');}
function sourceLabel(source){return `${source.kind==='essence'?source.label:dn(source.name)} ${source.id.toUpperCase()}`;}
function renderRoute(route,container='result'){
 RouteGuide.render($(container),route,{catalog,state,demons:dm,skillLink,entryLink,configKey,exportText,onPersist:persistDesktopState,skillName:sn,toast});
}
function exportText(){const r=lastResult;if(!r)return;const content=['真女5复仇 · SMT V Vengeance',`目标：${dn(r.target)} (${r.target})`,`技能：${r.skills.map(sn).join(' / ')}`,'','前提：全书召唤材料，满足所列解锁条件，已解锁所需技能栏位；按步骤准备材料。','材料：',...r.materials.map(m=>`${m.id.toUpperCase()}: ${dn(m.name)} (${m.name}) · 练至 Lv.${m.level} · 保留 ${m.learn.map(sn).join(' / ')}`),'',...r.steps.flatMap(s=>s.type==='essence'?[`${s.number}. ${dn(s.result)} [${s.sourceId.toUpperCase()}] 使用 ${s.essenceLabel} → [${s.id.toUpperCase()}]`,...s.grant.map(skill=>`灵体授技 ${sn(skill)} ← ${s.essenceLabel}`)]:[`${s.number}. ${s.ingredients.map((n,i)=>`${dn(n)} [${s.materialIds[i].toUpperCase()}]`).join(' + ')} → ${dn(s.result)} [${s.id.toUpperCase()}]`,...s.inherit.map(skill=>`继承 ${sn(skill)} ← ${(s.inheritSources?.[skill]||[]).map(sourceLabel).join(' 或 ')}`),...s.learn.map(skill=>{const source=s.learnSources?.[skill];return `自身习得 ${sn(skill)} ← ${dn(s.result)} ${s.id.toUpperCase()} · ${source?.initial?'初始自带':'Lv.'+(source?.level||s.level)+' 习得'}`;}),s.reason?'待核实：'+s.reason:'']),'解锁条件：',...Object.entries(r.conditions).map(([n,c])=>`${dn(n)}: ${c}`),'',`规则版本 ${catalog.version}；源提交 ${catalog.source}`,`费用：${money(r.totalCost||0)}；${r.objective==='mixed'?r.fusionCount+' 次合体＋'+r.essenceCount+' 次灵体授技':r.stepCount+' 次合体'}。已按当前材料、技能与召唤价格规则求得最优解。`, '费用仅包括起始材料召唤，未包含练级道具和临时全书存取费用。'].map(line=>SmtvvI18n.text(line)).join('\n');const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=SmtvvI18n.text(`${dn(r.target)}-合体路线.txt`);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('share').onclick=async()=>{if(!state.target){toast('请先选择目标');return;}try{Object.assign(state,readSettings());const url=location.origin+location.pathname+'#config='+encodeURIComponent(JSON.stringify(state));await navigator.clipboard.writeText(url);toast(localService?'已复制配置链接；其他设备需先能访问此服务':'已复制配置链接');}catch(e){toast('复制失败：'+e.message);}};
let demonCategory='',skillCategory='';
function raceGroups(){return [...new Map(catalog.demons.map(d=>[d.race,d.raceLabel])).entries()].sort((a,b)=>a[0]==='Element'?-1:b[0]==='Element'?1:a[1].localeCompare(b[1],SmtvvI18n.locale));}
function libraryCategories(){
 GameSite.catalogUI.updateCategories($('demon-categories'),[['','全部种族'],...raceGroups()].map(([key,label])=>[key,label,catalog.demons.filter(d=>!key||d.race===key).length]),'data-race-category',demonCategory);
 GameSite.catalogUI.updateCategories($('skill-categories'),[['','全部类别'],...Object.entries(elements).filter(([key])=>catalog.skills.some(s=>s.element===key))].map(([key,label])=>[key,label,catalog.skills.filter(s=>!key||s.element===key).length,key]),'data-skill-category',skillCategory);
}
$('demon-categories').onclick=e=>{const b=e.target.closest('[data-race-category]');if(b){demonCategory=b.dataset.raceCategory;libraryCategories();demonTable();}};
$('skill-categories').onclick=e=>{const b=e.target.closest('[data-skill-category]');if(b){skillCategory=b.dataset.skillCategory;libraryCategories();skillTable();}};
function demonTable(){
 const q=queryText($('demon-filter').value),method=$('demon-method').value;
 const ds=catalog.demons.filter(d=>(!demonCategory||d.race===demonCategory)&&matchesQuery(d,q)&&(!method||method==='dlc'&&d.dlc||method==='special'&&d.special.length||method==='accident'&&d.accident||method==='normal'&&!d.special.length&&!d.accident));
 $('demon-count').textContent=`显示 ${ds.length} / ${catalog.demons.length} 只`;
 GameSite.catalogUI.render('demons',$('demon-table'),ds);
 demonUI.hydrate($('demon-table'),activeTab==='demons');
}
GameSite.bindSearch($('demon-filter'),demonTable);$('demon-method').onchange=demonTable;
$('demon-table').onclick=e=>{const b=e.target.closest('[data-plan]');if(b){activate('planner');setPlannerView('build',false);chooseTarget(b.dataset.plan);$('target-card').scrollIntoView({behavior:'smooth',block:'center'});}};
function skillTable(){
 const q=queryText($('skill-filter').value),inherit=$('skill-inherit').value;
 const rows=orderedSkills.filter(s=>(!skillCategory||s.element===skillCategory)&&matchesSkillName(s,q)&&(!inherit||inherit==='unique'&&s.unique||inherit==='normal'&&!s.unique));
 $('skill-total').textContent=`显示 ${rows.length} / ${catalog.skills.length} 个技能`;
 GameSite.catalogUI.render('skills',$('skill-table'),rows);

}
GameSite.bindSearch($('skill-filter'),skillTable);$('skill-inherit').onchange=skillTable;
let essenceCategory='';
const essenceGroups={demon:'仲魔灵体',aogami:'青神灵体',tsukuyomi:'月读灵体',other:'其他灵体'};
function renderEssenceCategories(){GameSite.catalogUI.updateCategories($('essence-categories'),[['','全部'],...Object.entries(essenceGroups)].map(([key,title])=>[key,title,catalog.essences.filter(e=>!key||e.group===key).length]),'data-essence-category',essenceCategory);}
function essenceTable(){const q=queryText($('essence-filter').value),element=$('essence-element').value;const rows=catalog.essences.filter(e=>(!essenceCategory||e.group===essenceCategory)&&(!element||e.skills.some(s=>s.element===element))&&matchesQuery(e,q));$('essence-count').textContent=`${rows.length} / ${catalog.essences.length} 个灵体`;GameSite.catalogUI.render('essences',$('essence-table'),rows,{groups:essenceGroups,query:q});demonUI.hydrate($('essence-table'),activeTab==='essences');}

function initEssenceOptions(){if($('essence-element').options.length===1)$('essence-element').innerHTML='<option value="">全部技能属性</option>'+Object.entries(elements).map(([key,title])=>`<option value="${key}">${title}</option>`).join('');}
GameSite.bindSearch($('essence-filter'),essenceTable);
function initEssenceTable(){renderEssenceCategories();initEssenceOptions();$('essence-element').onchange=essenceTable;$('essence-categories').onclick=e=>{const b=e.target.closest('[data-essence-category]');if(b){essenceCategory=b.dataset.essenceCategory;renderEssenceCategories();essenceTable();}};essenceTable();}
document.querySelectorAll('[data-reset-catalog]').forEach(button=>button.onclick=()=>{
 const kind=button.dataset.resetCatalog;
 if(kind==='demons'){$('demon-filter').value='';$('demon-method').value='';demonCategory='';libraryCategories();demonTable();}
 else if(kind==='skills'){$('skill-filter').value='';$('skill-inherit').value='';skillCategory='';libraryCategories();skillTable();}
 else {$('essence-filter').value='';$('essence-element').value='';essenceCategory='';renderEssenceCategories();essenceTable();}
 persistDesktopState();
});
function restore(saved){
 if(!saved||typeof saved!=='object'||Array.isArray(saved))return;
 const validDemon=n=>typeof n==='string'&&Object.hasOwn(dm,n);
 const validNames=xs=>Array.isArray(xs)?[...new Set(xs.filter(validDemon))]:[];
 state={target:validDemon(saved.target)?saved.target:'',skills:Array.isArray(saved.skills)?[...new Set(saved.skills.filter(s=>typeof s==='string'&&Object.hasOwn(sm,s)))].slice(0,8):[],sources:{},level:Number.isInteger(saved.level)&&saved.level>=1&&saved.level<=150?saved.level:150,slots:Number.isInteger(saved.slots)&&saved.slots>=1&&saved.slots<=8?saved.slots:8,dlc:saved.dlc===false?[]:Array.isArray(saved.dlc)?validNames(saved.dlc).filter(n=>dm[n].dlc):['Dagda','Konohana Sakuya'],locked:validNames(saved.locked),excluded:validNames(saved.excluded),allowUncertain:saved.allowUncertain===true,starting:Array.isArray(saved.starting)?validNames(saved.starting):null,prices:{}};
 if(saved.prices&&typeof saved.prices==='object'&&!Array.isArray(saved.prices))for(const [n,p]of Object.entries(saved.prices))if(validDemon(n)&&Number.isInteger(p)&&p>=0&&p<=100000000)state.prices[n]=p;
 if(saved.sources&&typeof saved.sources==='object'&&!Array.isArray(saved.sources))for(const [s,n]of Object.entries(saved.sources))if(state.skills.includes(s)&&validDemon(n))state.sources[s]=n;
}
async function init(){try{catalog=await GameSite.catalog;dm=Object.fromEntries(catalog.demons.map(d=>[d.name,d]));sm=Object.fromEntries(catalog.skills.map(s=>[s.name,s]));$('status').textContent='资料已载入，正在整理图像…';
 orderedSkills=[...catalog.skills].sort((a,b)=>(elementOrder.get(a.element)??elementOrder.size)-(elementOrder.get(b.element)??elementOrder.size));
 const races=[...new Map(catalog.demons.map(d=>[d.race,d.raceLabel])).entries()];$('race').innerHTML='<option value="">全部种族</option>'+races.map(([n,l])=>`<option value="${esc(n)}">${esc(l)}</option>`).join('');

 try{const shared=new URLSearchParams(location.hash.slice(1)).get('config');if(shared){if(shared.length>64000)throw Error('配置链接过长');restore(JSON.parse(shared));}else restore(JSON.parse(localStorage.getItem('smtvv-config-v1')||'null'));}catch(e){toast('未能恢复配置，已使用默认设置');}
 $('planner-settings').open=!GameSite.compact.matches;
 $('dlc-options').innerHTML=catalog.demons.filter(d=>d.dlc).map(d=>`<label class="checkbox-setting"><input type="checkbox" data-dlc="${esc(d.name)}">${esc(d.label)} DLC</label>`).join('');
 document.querySelectorAll('[data-dlc]').forEach(e=>e.onchange=onSettings);
 initPickers();initEssenceOptions();settingsToUI();renderTarget();renderSlots();restoreDesktopState();
 const params=new URLSearchParams(location.search),initialTab=params.get('tab');activate(pendingTab||initialTab||activeTab,false);pendingTab='';const query=params.get('q');
 if(query&&initialTab==='essences'){essenceCategory='';$('essence-element').value='';$('essence-filter').value=query;renderEssenceCategories();essenceTable();}
 if(query&&initialTab==='demons'){demonCategory='';$('demon-method').value='';$('demon-filter').value=query;libraryCategories();demonTable();}
 if(query&&initialTab==='skills'){skillCategory='';$('skill-inherit').value='';$('skill-filter').value=query;libraryCategories();skillTable();}
 if(params.get('settings')==='1')$('settings').open=true;
 const running=readActiveRequest();applyEntryAction();if(state.target){const objective=selectedObjective;changed();selectedObjective=objective;const restored=restoreRoutes();if(!restoreActiveRequest(running)&&!restored)setPlannerView('build',false);}
 else {$('calculate').disabled=true;forgetActiveRequest();restoreActiveRequest(running);if(state.skills.length)computeStatus(state.skills.length+' 个技能 · 尚未选择目标');}
 if(restoreScroll!==null){const y=restoreScroll;restoreScroll=null;requestAnimationFrame(()=>window.scrollTo(0,y));}
 $('example').disabled=false;$('clear-skills').disabled=false;publishCatalogStatus();document.body.dataset.catalogState='ready';
 }catch(e){document.body.dataset.catalogState='error';$('status').textContent='数据未就绪';plannerError(localService?e.message+'。请确认通过启动脚本运行本地服务。':'资料暂时无法加载，请刷新页面重试。');$('calculate').disabled=true;$('example').disabled=true;$('clear-skills').disabled=true;if($('retry-data'))$('retry-data').hidden=false;}finally{for(const id of ['target-card','skill-slots'])$(id).setAttribute('aria-computation.busy','false');}}
if($('retry-data'))$('retry-data').onclick=()=>location.reload();
let restoreScroll=null;
function persistDesktopState(){
 if(!catalog)return;
 const filters=Object.fromEntries(['demon-filter','demon-method','skill-filter','skill-inherit','essence-filter','essence-element'].map(id=>[id,$(id).value]));
 tabScroll[activeTab]=scrollY;GameSite.write('smtvv-desktop-view',{tab:activeTab,plannerView,filters,demonCategory,skillCategory,essenceCategory,objective:selectedObjective||lastResult?.objective||'',scroll:scrollY,tabScroll,settingsOpen:$('settings').open,pricesOpen:document.querySelector('.route-search-settings').open,config:configKey()});save();
}
window.persistDesktopState=persistDesktopState;
function restoreDesktopState(){
 const saved=GameSite.read('smtvv-desktop-view');if(!saved||typeof saved!=='object'||Array.isArray(saved))return;
 for(const [id,value]of Object.entries(saved.filters||{}))if($(id)&&typeof value==='string')$(id).value=value;
 demonCategory=raceGroups().some(([race])=>race===saved.demonCategory)?saved.demonCategory:'';skillCategory=Object.hasOwn(elements,saved.skillCategory)?saved.skillCategory:'';essenceCategory=Object.hasOwn(essenceGroups,saved.essenceCategory)?saved.essenceCategory:'';
 tabScroll=saved.tabScroll&&typeof saved.tabScroll==='object'?saved.tabScroll:{};$('settings').open=saved.settingsOpen===true;document.querySelector('.route-search-settings').open=saved.pricesOpen===true;
 activate(saved.tab||'planner',false);
 const params=new URLSearchParams(location.search),sameConfig=saved.config===configKey()||saved.config===JSON.stringify(state);
 if(sameConfig){setPlannerView(saved.plannerView||'build',false);selectedObjective=saved.objective||'';if(!params.has('q')&&(!params.has('tab')||params.get('tab')===saved.tab))restoreScroll=Number(saved.scroll)||0;}
}
function applyEntryAction(){
 const p=new URLSearchParams(location.search),target=p.get('target'),skill=p.get('addSkill'),openBuild=p.get('view')==='build';
 if(target&&Object.hasOwn(dm,target)){activate('planner',false);chooseTarget(target);}
 if(skill&&Object.hasOwn(sm,skill)){activate('planner',false);if(sm[skill].unique&&!(skill in (dm[state.target]?.skills||{})))toast('该技能为其他仲魔专属，不能加入当前目标');else{slotToFill=null;addSkill(skill);if(!state.target)$('target-search').focus();}}
 if(target||skill||openBuild){activate('planner',false);setPlannerView('build',false);const url=new URL(location.href);url.searchParams.set('tab','planner');url.searchParams.delete('target');url.searchParams.delete('addSkill');url.searchParams.delete('view');url.hash='';history.replaceState(null,'',url);restoreScroll=null;tabScroll.planner=0;if(openBuild)window.scrollTo({top:0,behavior:'instant'});}
}
function consumeSharedConfig(){
 if(!catalog)return false;const shared=new URLSearchParams(location.hash.slice(1)).get('config');if(!shared)return false;
 try{if(shared.length>64000)throw Error('配置链接过长');restore(JSON.parse(shared));settingsToUI();renderTarget();renderSlots();restoreScroll=null;activate('planner',false);setPlannerView('build',false);changed();window.scrollTo(0,0);}catch(e){toast('配置链接无效：'+e.message);}return true;
}
window.addEventListener('hashchange',consumeSharedConfig);
window.addEventListener('popstate',()=>{if(!catalog||consumeSharedConfig())return;const tab=new URLSearchParams(location.search).get('tab')||'planner';if(tab===activeTab)return;activate(tab,false);requestAnimationFrame(()=>window.scrollTo(0,tabScroll[activeTab]||0));});
init();

Object.defineProperties(window,{busy:{get:()=>computation.busy},activeJob:{get:()=>computation.jobId}});
