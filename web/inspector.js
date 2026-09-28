'use strict';
(() => {
  const {catalog, esc, icon, demonUI} = GameSite;
  const elements = {phy:'物理',fir:'火炎',ice:'冰结',ele:'电击',for:'冲击',lig:'破魔',dar:'咒杀',alm:'万能',ail:'异常',rec:'回复',sup:'辅助',pas:'被动',spe:'特殊'};
  const groups = {demon:'仲魔灵体',aogami:'青神灵体',tsukuyomi:'月读灵体',other:'其他灵体'};
  const state = {demons:new Map(), skills:new Map(), essences:new Map()};
  const inspector = document.getElementById('catalog-preview');
  if (!inspector) return;
  let trigger;
  const symbol = key => GameSite.skillUI?.symbol(key) || '';
  const skill = name => state.skills.get(name);
  function show(panel, html) {
    inspector.innerHTML = `<button type="button" class="preview-close icon-button" data-close-preview aria-label="关闭预览">${icon('X')}</button>` + html;
    inspector.querySelector('h3').id = 'catalog-preview-title';
    inspector.showModal();inspector.scrollTop=0;
    document.body.classList.add('preview-open');
    inspector.querySelector('[data-close-preview]').focus({preventScroll:true});
  }
  inspector.addEventListener('close',()=>{
    trigger?.setAttribute('aria-expanded','false');
    trigger?.closest('.catalog-card')?.classList.remove('is-inspecting');
    document.body.classList.remove('preview-open');
    if (trigger?.isConnected) trigger.focus({preventScroll:true});
    trigger = null;
  });
  inspector.addEventListener('click',event=>{
    if(event.target.closest('[data-close-preview]'))inspector.close();
    else if(event.target===inspector){
      const rect=inspector.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)inspector.close();
    }
  });
  function demonPreview(panel, demon) {
    if (!demon) return;
    const skills = Object.entries(demon.skills).map(([name, level]) => {
      const data = skill(name);
      return '<li>' + (data ? symbol(data.element) : '') + '<span>' + esc(data?.label || name) + '</span><small>' + (level < 1 ? '初始' : 'Lv.' + level) + '</small></li>';
    }).join('');
    const portrait = `<div class="preview-art"><span class="summoning-seal" aria-hidden="true"></span>${demonUI.image(demon.name,'hero','eager')}</div>`;
    show(panel, '<div class="inspector-kicker">仲魔预览 · ' + esc(demon.raceLabel) + '</div>' + portrait + '<h3>' + esc(demon.label) + '</h3><p class="inspector-id">' + esc(demon.name) + ' · Lv.' + demon.level + '</p>' + demonUI.profile(demon,'preview') + '<div class="inspector-rule"></div><dl class="inspector-facts"><div><dt>合体方式</dt><dd>' + (demon.special.length ? '特殊合体' : demon.accident ? '合体事故' : '普通合体') + '</dd></div><div><dt>基准召唤价</dt><dd>' + Number(demon.basePrice).toLocaleString(SmtvvI18n.locale) + '</dd></div></dl><h4>属性耐性</h4><div class="inspector-resists">' + GameSite.skillUI.resists(demon) + '</div>' + GameSite.skillUI.innate(demon,'demons') + '<h4>习得技能</h4><ul class="inspector-skills">' + skills + '</ul><div class="inspector-actions"><a class="primary with-icon" href="/?tab=planner&target=' + encodeURIComponent(demon.name) + '">配置此仲魔 ' + icon('ArrowRight') + '</a><a class="inspector-link" href="/demon.html?name=' + encodeURIComponent(demon.name) + '&from=demons">打开完整资料 ' + icon('ArrowUpRight') + '</a></div>');
  }
  function skillPreview(panel, data) {
    if (!data) return;
    show(panel, '<div class="inspector-kicker">技能预览 · ' + esc(data.categoryZh || elements[data.element] || '技能') + '</div><h3>' + symbol(data.element) + esc(data.label) + '</h3><p class="inspector-id">' + esc(data.name) + '</p><div class="inspector-rule"></div><p class="inspector-effect">' + esc(data.effectZh || '效果待补充') + '</p><dl class="inspector-facts"><div><dt>基础消耗</dt><dd>' + esc(data.costZh || '无') + '</dd></div><div><dt>继承</dt><dd>' + (data.unique ? '专属' : '可继承') + '</dd></div><div><dt>习得来源</dt><dd>' + data.sources.length + ' 个</dd></div></dl><a class="inspector-link" href="/skill.html?name=' + encodeURIComponent(data.name) + '&from=skills">打开完整资料 ' + icon('ArrowUpRight') + '</a>');
  }
  function essencePreview(panel, data) {
    if (!data) return;
    const transferable = data.skills.filter(item => item.transferable).length;
    show(panel, '<div class="inspector-kicker">灵体预览 · ' + esc(groups[data.group] || '灵体') + '</div>' + demonUI.image(data.name,'hero','eager') + '<h3>' + esc(data.label) + '</h3><p class="inspector-id">' + esc(data.name) + ' · Lv.' + data.level + '</p><div class="inspector-rule"></div><dl class="inspector-facts"><div><dt>包含技能</dt><dd>' + data.skills.length + ' 个</dd></div><div><dt>可转授</dt><dd>' + transferable + ' 个</dd></div></dl><ul class="inspector-skills">' + data.skills.map(item => '<li>' + symbol(item.element) + '<span>' + esc(item.label) + '</span><small>' + (item.transferable ? '可转授' : '专属') + '</small></li>').join('') + '</ul><a class="inspector-link" href="/essence.html?name=' + encodeURIComponent(data.name) + '&from=essences">打开完整资料 ' + icon('ArrowUpRight') + '</a>');
  }
  function attach(data) {
    data.demons.forEach(item => state.demons.set(item.name, item));
    data.skills.forEach(item => state.skills.set(item.name, item));
    data.essences.forEach(item => state.essences.set(item.name, item));
    document.addEventListener('click', event => {
      const button=event.target.closest('[data-catalog-preview]');
      if(!button)return;
      const row = button.closest('[data-demon-name],[data-skill-name],[data-essence-name]');
      if (!row) return;
      const panel = row.closest('.tab-panel');
      panel?.querySelectorAll('.is-inspecting').forEach(item => item.classList.remove('is-inspecting'));
      row.classList.add('is-inspecting');
      trigger=button;button.setAttribute('aria-expanded','true');
      if (row.dataset.demonName) demonPreview(panel, state.demons.get(row.dataset.demonName));
      else if (row.dataset.skillName) skillPreview(panel, state.skills.get(row.dataset.skillName));
      else essencePreview(panel, state.essences.get(row.dataset.essenceName));
    });
  }
  catalog.then(attach).catch(() => {});
})();
