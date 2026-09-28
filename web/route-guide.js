'use strict';
(() => {
  const {esc, icon, read, write, demonUI} = GameSite;
  function render(root, route, context) {
    const {catalog, state, demons, skillLink, entryLink, configKey, exportText, onPersist} = context;
    if (!route.found) { root.innerHTML = `<div class="empty-state">${esc(route.message || '当前条件下没有可行路线')}</div>`; return; }
    const key = JSON.stringify([catalog.version,configKey(),route.objective,route.steps]);
    const legacyKey = JSON.stringify([catalog.version,state,route.objective,route.steps]);
    const stored = read('smtvv-route-progress', {});
    const saved = stored?.[key] || stored?.[legacyKey] || {};
    let current = Number.isInteger(saved.current) && route.steps[saved.current] ? saved.current : 0;
    let panel = ['steps','materials','skills'].includes(saved.panel) ? saved.panel : 'steps';
    const dn = name => demons[name]?.label || name;
    const stepsById = new Map(route.steps.map((step,index) => [step.id,index]));
    const nodesById = new Map([...route.materials, ...route.steps].map(node => [node.id,node]));
    const heldSkills = id => { const node = nodesById.get(id); return node?.keep || node?.learn || []; };
    const type = step => step.type === 'essence' ? '灵体授技' : step.special ? '特殊合体' : '二身合体';
    const origin = id => stepsById.has(id) ? '第 ' + (stepsById.get(id) + 1) + ' 步产物' : '起始材料';
    const reference = (id,label=origin(id)) => `<button class="reference-button" data-origin="${esc(id)}" title="查看${esc(origin(id))}">${esc(label)}${icon('CornerUpLeft')}</button>`;
    function save() {
      const all = read('smtvv-route-progress', {});
      const entries = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
      entries[key] = {current,panel};
      const keys = Object.keys(entries);
      while (keys.length > 12) delete entries[keys.shift()];
      if (!write('smtvv-route-progress',entries)) context.toast?.('进度未能保存：浏览器存储空间不足');
      onPersist?.();
    }
  function skills(title,rows){
    return `<section class="ledger-node-skills"><h3>${esc(title)}<small>${rows.length}</small></h3>${rows.length?`<ul class="ledger-skills">${rows.map(row=>`<li data-skill="${esc(row.name)}">${skillLink(row.name,context.skillName(row.name))}${row.note?`<small class="ledger-skill-note">${row.note}</small>`:''}</li>`).join('')}</ul>`:'<p class="ledger-no-skills">无指定保留技能</p>'}</section>`;
  }
  function node(name,id,rows,{role='input',kind='demon',label='',title='提供技能',final=false,meta=''}={}){
    const source=nodesById.get(id);
    const info=meta||`${esc(demons[name]?.raceLabel||'')} · Lv.${source?.level||demons[name]?.level||''}`;
    return `<div class="ledger-node ${role==='result'?'ledger-result':''} ${final?'ledger-final-node':''}" data-role="${role}" data-node-id="${esc(id)}"><div class="ledger-person">${demonUI.image(name,'route','eager')}<div><strong>${entryLink(kind,name,label||dn(name))}</strong><small>${info}</small><div class="ledger-node-origin">${role==='result'?final?'最终目标':'本步产物':role==='essence'?'消耗灵体':reference(id)}</div></div></div>${skills(title,rows)}</div>`;
  }
  function formula(step,final){
    let inputs;
    if(step.type==='essence'){
      inputs=[node(step.result,step.sourceId,step.keep.filter(name=>!step.grant.includes(name)).map(name=>({name})),{title:'原有保留'}),node(step.essence,step.id,step.grant.map(name=>({name})),{role:'essence',kind:'essence',label:step.essenceLabel,title:'授予技能',meta:`授予 ${step.grant.length} 项`})];
    }else{
      const assigned=new Map(step.materialIds.map(id=>[id,[]]));
      for(const name of step.inherit){
        const donors=step.inheritSources?.[name]||step.materialIds.filter(id=>heldSkills(id).includes(name)).map(id=>({id}));
        const ids=step.materialIds.filter(id=>donors.some(source=>source.id===id));
        if(!ids.length)throw Error('Missing skill donor: '+name);
        const alternatives=ids.slice(1).map(id=>{const source=nodesById.get(id);return reference(id,dn(source.name||source.result));});
        assigned.get(ids[0]).push({name,note:alternatives.length?`<span>也可由</span>${alternatives.join(' 或 ')}<span>提供</span>`:''});
      }
      inputs=step.ingredients.map((name,index)=>node(name,step.materialIds[index],assigned.get(step.materialIds[index])));
    }
    const result=step.keep.map(name=>{
      let note='';
      if(step.type==='essence'&&step.grant.includes(name))note='<span class="ledger-new">新增</span>';
      else if(step.learn.includes(name)){
        const source=step.learnSources?.[name];const initial=source?.initial??(demons[step.result]?.skills[name]<1);
        note=initial?'初始自带':'练至 Lv.'+(source?.level||step.level)+' 习得';
      }
      return {name,note};
    });
    const resultNode=node(step.result,step.id,result,{role:'result',title:'完成后保留',final});
    return `<div class="ledger-equation ${inputs.length>2?'ledger-equation-many':''}"><div class="ledger-inputs">${inputs.join(`<span class="ledger-operator" aria-hidden="true">${icon('Plus')}</span>`)}</div><span class="ledger-operator ledger-arrow" aria-hidden="true">${icon('ArrowRight')}</span>${resultNode}</div>`;
  }
    function carriers(sources) {
      return sources.map(source => `<span class="carrier">${source.kind === 'essence' ? entryLink('essence',source.name,source.label) : entryLink('demon',source.name,dn(source.name))}${source.id ? reference(source.id) : ''}</span>`).join('<span class="source-or">或</span>');
    }
    function stepBody(step,index) {
      return `<article class="operation-step overview-step ledger-step ${current === index ? 'is-current' : ''}" id="route-step-${index+1}" tabindex="-1">
        <div class="ledger-heading"><span class="ledger-number">${String(index+1).padStart(2,'0')}</span><h2>${type(step)}</h2>${step.unlock ? `<button type="button" class="quiet step-requirement-toggle" aria-expanded="false" aria-controls="step-unlock-${index+1}">${icon('LockKeyhole')}<span>解锁条件</span>${icon('ChevronDown')}</button>` : ''}</div>
        ${step.unlock ? `<p id="step-unlock-${index+1}" class="step-requirement-text" hidden>${esc(step.unlock)}</p>` : ''}
        ${formula(step,index === route.steps.length-1)}
        ${step.reason ? `<p class="warning-box">${esc(step.reason)}</p>` : ''}
      </article>`;
    }
    function materialTable() {
      return `<div class="guide-sheet"><div class="sheet-heading"><h2>准备材料</h2><span>${route.materials.length} 份 · ${Number(route.totalCost || 0).toLocaleString(SmtvvI18n.locale)} 魔货</span></div><table class="materials-table"><thead><tr><th>编号</th><th>仲魔</th><th>准备等级</th><th>需要保留</th><th class="numeric">召唤价</th></tr></thead><tbody>${route.materials.map((material,index) => `<tr id="material-${esc(material.id)}"><td><span class="reference-id">${index+1}</span></td><td>${demonUI.identity(material.name,entryLink('demon',material.name,dn(material.name))+`<small>${esc(demons[material.name]?.raceLabel || '')}</small>`)}</td><td>Lv.${material.level}${material.level > demons[material.name].level ? '<small class="level-up">需练级</small>' : ''}</td><td><div class="material-skill-list">${material.learn.length ? material.learn.map(name => skillLink(name,context.skillName(name),'skill-detail-link')).join('') : '<span class="muted">无指定技能</span>'}</div></td><td class="numeric">${Number(material.price || 0).toLocaleString(SmtvvI18n.locale)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    function finalSkills() {
      return `<div class="guide-sheet"><div class="sheet-heading"><h2>${esc(dn(route.target))} · 最终技能</h2><span>${route.skills.length} / ${state.slots}</span></div><table class="final-skills-table"><thead><tr><th>技能</th><th>最初习得来源</th><th>来源条件</th></tr></thead><tbody>${route.skills.map(name => {
        const sources = route.skillSources?.[name] || [];
        return `<tr><td>${skillLink(name,context.skillName(name),'skill-detail-link')}</td><td>${carriers(sources)}</td><td>${sources.map(source => source.kind === 'essence' ? '灵体授予' : source.initial ? '初始自带' : 'Lv.' + source.level + ' 习得').join(' / ')}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    root.innerHTML = `<section class="execution-workspace">
      <div class="guide-toolbar"><div class="guide-tabs" role="tablist" aria-label="路线内容"><button data-guide-panel="steps" role="tab">全部步骤 <span>${route.steps.length}</span></button><button data-guide-panel="materials" role="tab">准备材料 <span>${route.materials.length}</span></button><button data-guide-panel="skills" role="tab">最终技能 <span>${route.skills.length}</span></button></div><button class="quiet icon-button" id="export-text" data-tooltip="导出完整步骤" aria-label="导出完整步骤">${icon('Download')}</button></div>
      <div class="execution-layout"><aside class="step-navigation" aria-label="步骤目录"><div class="step-nav-heading"><strong>步骤目录</strong><div class="jump-controls"><label class="sr-only" for="jump-step">跳到第几步</label><input id="jump-step" type="number" min="1" max="${route.steps.length}" value="${current+1}" aria-label="跳到第几步"><button id="jump-go" class="quiet icon-button" aria-label="跳转到指定步骤" data-tooltip="跳转到指定步骤">${icon('CornerDownRight')}</button></div></div><div class="step-nav-list"></div></aside><div class="guide-content route-ledger" id="guide-content" tabindex="-1"></div></div>
    </section>`;
    const content = root.querySelector('.guide-content');
    function paintNavigation() {
      root.querySelector('.step-nav-list').innerHTML = route.steps.map((step,index) => `<button class="step-nav-item ${panel === 'steps' && current === index ? 'active' : ''}" data-select-step="${index}" ${panel === 'steps' && current === index ? 'aria-current="step"' : ''}><span class="nav-step-number">${String(index+1).padStart(2,'0')}</span><span><strong>${esc(dn(step.result))}</strong><small>${type(step)}</small></span>${panel === 'steps' && current === index ? icon('ChevronRight') : ''}</button>`).join('');
      root.querySelectorAll('[data-guide-panel]').forEach(button => { button.setAttribute('aria-selected',String(button.dataset.guidePanel === panel)); button.classList.toggle('active',button.dataset.guidePanel === panel); });
      root.querySelector('#jump-step').value = current + 1;
      content.querySelectorAll('.operation-step').forEach(step => step.classList.toggle('is-current',step.id === 'route-step-' + (current + 1)));
      requestAnimationFrame(() => {
        const list = root.querySelector('.step-nav-list');
        const nav = list?.querySelector('[aria-current="step"]');
        if (!nav || !list.getClientRects().length) return;
        if (list.scrollWidth > list.clientWidth + 1) {
          const item = nav.getBoundingClientRect(), viewport = list.getBoundingClientRect();
          if (item.left < viewport.left) list.scrollLeft -= viewport.left - item.left;
          else if (item.right > viewport.right) list.scrollLeft += item.right - viewport.right;
        } else list.scrollTop = Math.max(0,nav.offsetTop-list.offsetTop-80);
      });
    }
    function paintContent() {
      if (panel === 'materials') content.innerHTML = materialTable();
      else if (panel === 'skills') content.innerHTML = finalSkills();
      else content.innerHTML = route.steps.length ? route.steps.map(stepBody).join('') : '<p class="empty-state">没有额外操作</p>';
      root.querySelector('.execution-layout').classList.toggle('sheet-view',panel !== 'steps');
    }
    const scrollBehavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    function select(index) {
      const changedPanel = panel !== 'steps';
      current = Math.max(0,Math.min(route.steps.length-1,index)); panel = 'steps';
      if (changedPanel) paintContent();
      paintNavigation(); save();
      const step = root.querySelector('#route-step-' + (current + 1));
      step?.focus({preventScroll:true});
      step?.scrollIntoView({block:'start',behavior:scrollBehavior()});
    }
    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button) || button.disabled) return;
      if (button.classList.contains('step-requirement-toggle')) {
        const open=button.getAttribute('aria-expanded')!=='true';
        button.setAttribute('aria-expanded',String(open));
        root.querySelector('#'+button.getAttribute('aria-controls')).hidden=!open;
      } else if (button.dataset.selectStep !== undefined) select(Number(button.dataset.selectStep));
      else if (button.dataset.guidePanel) { panel=button.dataset.guidePanel; paintNavigation(); paintContent(); save(); }
      else if (button.dataset.origin) {
        const id = button.dataset.origin;
        if (stepsById.has(id)) select(stepsById.get(id));
        else { panel='materials'; paintNavigation(); paintContent(); save(); requestAnimationFrame(() => root.querySelector('#material-' + id)?.scrollIntoView({block:'center',behavior:scrollBehavior()})); }
      } else if (button.id === 'jump-go') {
        const value = Number(root.querySelector('#jump-step').value);
        if (Number.isInteger(value) && value >= 1 && value <= route.steps.length) select(value-1);
        else root.querySelector('#jump-step').reportValidity();
      } else if (button.id === 'export-text') exportText();
    });
    root.querySelector('#jump-step').addEventListener('keydown', event => { if (event.key === 'Enter') root.querySelector('#jump-go').click(); });
    paintNavigation(); paintContent();
  }
  window.RouteGuide = {render};
})();
