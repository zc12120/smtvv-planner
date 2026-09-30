'use strict';
// Presentation for the three collections. Search and canonical IDs stay in app.js.
(() => {
  const {esc, icon, demonUI, skillUI, read, write} = GameSite;
  const href = (kind, name, from) => `/${kind}.html?name=${encodeURIComponent(name)}&from=${from}`;
  const originalName = item => item.label === item.name ? '' : `<p class="record-original" lang="en">${esc(item.name)}</p>`;
  const preview = () => `<button type="button" class="record-preview" data-catalog-preview aria-haspopup="dialog" aria-controls="catalog-preview" aria-expanded="false">快速预览 ${icon('ArrowUpRight')}</button>`;
  const empty = message => `<div class="collection-empty">${icon('SearchX')}<h3>没有匹配结果</h3><p>${message}</p></div>`;
  const order = index => `style="--arrival:${Math.min(index, 7)}"`;
  const method = demon => demon.accident ? '合体事故' : demon.special.length ? '特殊合体' : '普通合体';
  const columnKey = 'smtvv-catalog-columns-v1';
  const columnKinds = ['demons','skills','essences'];
  const collections = new Map();
  const columnValue = value => typeof value === 'string' && /^[1-6]$/.test(value) ? value : 'auto';
  function readColumns() {
    const saved = read(columnKey, {});
    return Object.fromEntries(columnKinds.map(kind => [kind,columnValue(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved[kind] : null)]));
  }
  let columns = readColumns();
  function columnAttributes(kind) {
    const value = columns[kind];
    return `data-collection-kind="${kind}" data-columns="${value}"${value === 'auto' ? '' : ` style="--catalog-columns:${value}"`}`;
  }
  function applyColumns(kind) {
    const value = columns[kind];
    const control = document.querySelector(`[data-catalog-columns="${kind}"]`);
    if (control) control.value = value;
    const grid = collections.get(kind)?.grid || document.querySelector(`.collection-grid[data-collection-kind="${kind}"]`);
    if (!grid) return;
    grid.dataset.columns = value;
    if (value === 'auto') grid.style.removeProperty('--catalog-columns');
    else grid.style.setProperty('--catalog-columns', value);
  }

  function demons(rows) {
    if (!rows.length) return empty('没有匹配的仲魔，请调整分类或搜索条件。');
    return `<div class="demon-collection collection-grid" ${columnAttributes('demons')}>${rows.map((demon,index) => `
      <article class="catalog-card demon-record" data-demon-name="${esc(demon.name)}" data-race="${esc(demon.race)}" ${order(index)}>
        <div class="record-topline"><span class="record-family">${esc(demon.raceLabel)}</span><span class="record-level"><small>LV.</small> ${demon.level}</span></div>
        <a class="record-art" href="${href('demon',demon.name,'demons')}" aria-label="${esc(demon.label)}">
          <span class="summoning-seal" aria-hidden="true"></span>${demonUI.image(demon.name,'hero','lazy')}
          ${demon.dlc ? '<span class="record-dlc">DLC</span>' : ''}
        </a>
        <div class="record-copy"><span class="record-method${demon.special.length || demon.accident ? ' is-special' : ''}">${method(demon)}</span>
          <h3><a class="record-detail-link" href="${href('demon',demon.name,'demons')}">${esc(demon.label)}</a></h3>${originalName(demon)}
        </div>
        <div class="record-affinities">${skillUI.resists(demon)}</div>
        <div class="record-actions"><button type="button" class="record-configure" data-plan="${esc(demon.name)}">${icon('Plus')}配置此仲魔</button>${preview()}</div>
      </article>`).join('')}</div>`;
  }

  function skills(rows) {
    if (!rows.length) return empty('没有匹配技能，请调整筛选条件。');
    return `<div class="skill-collection collection-grid" ${columnAttributes('skills')}>${rows.map((skill,index) => `
      <article class="catalog-card skill-record" data-skill-name="${esc(skill.name)}" data-affinity="${esc(skill.element)}" ${order(index)}>
        <div class="skill-record-heading"><a class="record-detail-link skill-record-link skill-detail-link" href="${href('skill',skill.name,'skills')}"><span class="archive-sigil">${skillUI.symbol(skill.element)}</span><div><span class="record-family">${esc(skill.categoryZh || skillUI.categories[skill.element])}</span><h3>${esc(skill.label)}</h3>${originalName(skill)}</div></a></div>
        <p class="record-effect">${esc(skill.effectZh || '效果待补充')}</p>
        <div class="record-facts"><div><span>基础消耗</span><strong>${esc(skill.costZh || '无')}</strong></div><div><span>继承</span><strong class="${skill.unique ? 'is-special' : ''}">${skill.unique ? '专属／不可继承' : '可继承'}</strong></div></div>
        <div class="record-actions"><span class="record-source-count">${icon('GitBranch')}<span>${skill.sources.length} 个习得来源</span></span>${preview()}</div>
      </article>`).join('')}</div>`;
  }

  function visibleSkills(essence, query) {
    return [...essence.skills].sort((a,b) => Number(!!query && GameSite.matchesQuery(b, query)) - Number(!!query && GameSite.matchesQuery(a, query))).slice(0,4);
  }
  function essenceSkillList(skills) {
    return skills.map(skill => `<li${skill.transferable ? '' : ' class="restricted"'}>${skillUI.link(skill.name,skill.label,'essences','skill-detail-link')}${skill.transferable ? '' : `<span class="transfer-lock" title="${esc(skill.restriction || '专属')}">${icon('LockKeyhole')}<span class="sr-only">${esc(skill.restriction || '专属')}</span></span>`}</li>`).join('');
  }
  function essences(rows, groups, query = '') {
    if (!rows.length) return empty('没有匹配的灵体或技能。');
    return `<div class="essence-collection collection-grid" ${columnAttributes('essences')}>${rows.map((essence,index) => {
      const visible = visibleSkills(essence, query);
      return `<article class="catalog-card essence-record" data-essence-name="${esc(essence.name)}" data-essence-group="${esc(essence.group)}" ${order(index)}>
        <div class="essence-record-heading"><a class="essence-vessel" href="${href('essence',essence.name,'essences')}" aria-label="${esc(essence.label)}"><span class="summoning-seal" aria-hidden="true"></span>${demonUI.image(essence.name,'hero','lazy')}</a><div><span class="record-family">${esc(groups[essence.group])}</span><h3><a class="record-detail-link" href="${href('essence',essence.name,'essences')}">${esc(essence.label)}</a></h3>${originalName(essence)}</div></div>
        <div class="essence-record-skills"><span class="record-section-label">包含技能 <small>${essence.skills.length}</small></span><ul>${essenceSkillList(visible)}</ul>${essence.skills.length > 4 ? `<span class="record-more">另有 ${essence.skills.length - 4} 个技能</span>` : ''}</div>
        <div class="record-actions"><span class="record-source-count">${icon('Layers2')}<span>${essence.skills.filter(skill => skill.transferable).length} 个可转授技能</span></span>${preview()}</div>
      </article>`;
    }).join('')}</div>`;
  }

  function updateCategories(container, items, attribute, selected) {
    const label = items.find(([key]) => key === selected)?.[1] || items[0][1];
    const summary = container.closest('details').querySelector('.catalog-index-selection');
    if (summary.textContent !== label) summary.textContent = label;
    // Keep existing buttons focused while a filter changes.
    if (!container.children.length) container.innerHTML = items.map(([key,label,count,element]) => `<button type="button" ${attribute}="${esc(key)}"><span class="category-label">${element ? skillUI.symbol(element) : !key ? icon('ListFilter') : ''}<span>${esc(label)}</span></span><small>${count}</small></button>`).join('');
    for (const button of container.querySelectorAll('button')) {
      const active = button.getAttribute(attribute) === selected;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    }
  }

  const renderers = {demons,skills,essences};
  const recordAttributes = {demons:'demonName',skills:'skillName',essences:'essenceName'};
  function render(kind, container, rows, {groups = {}, query = ''} = {}) {
    let collection = collections.get(kind);
    if (!collection) {
      const grid = document.createElement('div');
      grid.className = `${{demons:'demon',skills:'skill',essences:'essence'}[kind]}-collection collection-grid`;
      grid.dataset.collectionKind = kind;
      collection = {grid,container,records:new Map()};
      collections.set(kind, collection);
    }
    applyColumns(kind);
    if (!rows.length) {
      if (!container.querySelector('.collection-empty')) container.innerHTML = renderers[kind]([], groups, query);
      return;
    }
    const variants = new Map(rows.map(row => [row.name, kind === 'essences' ? JSON.stringify(visibleSkills(row,query).map(skill => skill.name)) : '']));
    const missing = rows.filter(row => {
      const record = collection.records.get(row.name);
      return !record || record.item !== row;
    });
    if (missing.length) {
      const template = document.createElement('template');
      template.innerHTML = renderers[kind](missing, groups, query);
      const items = new Map(missing.map(row => [row.name,row]));
      for (const node of template.content.firstElementChild.children) {
        const name = node.dataset[recordAttributes[kind]];
        collection.records.set(name, {node,item:items.get(name),variant:variants.get(name)});
      }
    }
    if (kind === 'essences') for (const row of rows) {
      const record = collection.records.get(row.name);
      if (record.variant === variants.get(row.name)) continue;
      record.node.querySelector('.essence-record-skills ul').innerHTML = essenceSkillList(visibleSkills(row,query));
      record.variant = variants.get(row.name);
    }
    const nodes = rows.map(row => collection.records.get(row.name).node);
    const grid = collection.grid;
    const previous = [...grid.children];
    // Reuse canonical records, but batch membership changes into one DOM update
    // instead of hundreds of individual removals and translation notifications.
    if (previous.length !== nodes.length || previous.some((node,index) => node !== nodes[index])) {
      const focused = document.activeElement;
      const restoreFocus = grid.contains(focused) && nodes.some(node => node.contains(focused));
      grid.replaceChildren(...nodes);
      if (restoreFocus) focused.focus({preventScroll:true});
    }
    nodes.forEach((node,index) => {
      const arrival = String(Math.min(index, 7));
      if (node.style.getPropertyValue('--arrival') !== arrival) node.style.setProperty('--arrival',arrival);
    });
    if (grid.parentElement !== container) container.replaceChildren(grid);
  }
  function release(kind) {
    const collection = collections.get(kind);
    if (!collection) return;
    collection.container.replaceChildren();
    collections.delete(kind);
  }

  function syncSearch(input) {
    const toolbar = input.closest('.catalog-toolbar');
    toolbar.querySelector('.search-query-label').textContent = input.value;
    toolbar.querySelector('[data-clear-search]').hidden = !input.value;
  }
  document.querySelectorAll('.catalog-toolbar').forEach(toolbar => {
    const trigger = toolbar.querySelector('[data-open-search]');
    const field = toolbar.querySelector('.catalog-query');
    const input = field.querySelector('input');
    function toggle(open) {
      field.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      (open ? input : trigger).focus({preventScroll:true});
    }
    trigger.onclick = () => toggle(field.hidden);
    toolbar.querySelector('[data-close-search]').onclick = () => toggle(false);
    toolbar.querySelector('[data-clear-search]').onclick = () => {
      input.value = '';
      input.dispatchEvent(new Event('input', {bubbles:true}));
      syncSearch(input);
      input.focus();
    };
    input.addEventListener('input', () => syncSearch(input));
    field.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); toggle(false); }
    });
  });
  GameSite.catalogUI = {demons,skills,essences,render,release,updateCategories,syncSearch};
  for (const kind of columnKinds) {
    applyColumns(kind);
    document.querySelector(`[data-catalog-columns="${kind}"]`)?.addEventListener('change', event => {
      columns[kind] = columnValue(event.target.value);
      write(columnKey, columns);
      applyColumns(kind);
    });
  }
  window.addEventListener('storage', event => {
    if (event.key !== null && event.key !== columnKey) return;
    columns = readColumns();
    columnKinds.forEach(applyColumns);
  });
  const compact = matchMedia('(max-width:899px)');
  document.querySelectorAll('.catalog-categories').forEach(container => container.addEventListener('click', event => {
    if (!compact.matches || !event.target.closest('button')) return;
    const index = container.closest('details');
    index.open = false;
    index.querySelector('summary').focus({preventScroll:true});
  }));
  function setIndexes() { document.querySelectorAll('details.catalog-index').forEach(index=>{index.open=!compact.matches;}); }
  setIndexes();compact.addEventListener('change',setIndexes);
})();
