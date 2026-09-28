'use strict';
(() => {
  const {catalog, fetchJson, esc, icon, read, tabs, demonUI} = GameSite;
  const kind = document.body.dataset.entry;
  const params = new URLSearchParams(location.search);
  const name = params.get('name') || '';
  const tab = {demon:'demons', skill:'skills', essence:'essences'}[kind];
  const from = Object.hasOwn(tabs,params.get('from')) ? params.get('from') : tab;
  const content = document.getElementById('entry-content');
  const back = document.getElementById('detail-back');
  let demons = {}, skills = {};
  const link = (type, id, label) => `<a href="/${type}.html?name=${encodeURIComponent(id)}&from=${from}">${esc(label)}</a>`;
  const skillLink = id => GameSite.skillUI.link(id, skills[id]?.label || id, from);
  const demonLink = id => demonUI.identity(id, link('demon', id, demons[id]?.label || id));
  const facts = values => `<div class="entry-facts">${values.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')}</div>`;
  const section = (title, body) => `<section class="entry-section"><h2>${title}</h2>${body}</section>`;
  const empty = text => `<p class="empty-state">${text}</p>`;
  const heading = (label, category, action = '', details = '', profile = '') => {
    const title = `<div class="entry-title-copy"><span class="entry-kind">${esc(category)}</span><h1>${kind==='skill'?GameSite.skillUI.symbol(skills[name]?.element):''}${esc(label)}</h1><p>${esc(name)}</p></div>`;
    const portrait = kind==='skill' ? '' : demonUI.image(name,'detail','eager');
    if (details) return `<div class="entry-heading entry-heading--demon${profile ? ' entry-heading--profile' : ''}"><div class="entry-identity">${portrait}<div class="entry-overview"><div class="entry-title-row">${title}${action}</div>${details}</div></div>${profile}</div>`;
    return `<div class="entry-heading"><div class="entry-identity">${portrait}${title}</div>${action}</div>`;
  };
  const planTarget = id => `<a class="primary with-icon" href="/?tab=planner&target=${encodeURIComponent(id)}">配置此仲魔 ${icon('ArrowRight')}</a>`;
  function addSkill(id, transferable = true, full = false) {
    const skill = skills[id];
    const config = read('smtvv-config-v1', {});
    const target = demons[config?.target];
    if (!skill || skill.element === 'innate' || !transferable || (skill.unique && !(id in (target?.skills || {})))) return '';
    const selected = Array.isArray(config?.skills) && config.skills.includes(id);
    const label = selected ? '已在技能配置中' : '加入技能配置';
    if (selected) return `<span class="muted">${icon('Check')}${full ? ' 已加入配置' : ''}</span>`;
    return `<a class="${full ? 'primary with-icon' : 'quiet icon-button'}" href="/?tab=planner&addSkill=${encodeURIComponent(id)}" aria-label="${esc(label + '：' + skill.label)}" data-tooltip="${label}">${icon('Plus')}${full ? '加入技能配置' : ''}</a>`;
  }
  function skillRows(entries, essence = false) {
    return `<table class="entry-skill-table" role="table"><thead role="rowgroup"><tr role="row"><th scope="col">技能</th><th scope="col">${essence ? '转授' : '习得等级'}</th><th scope="col">效果</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody role="rowgroup">${entries.map(item => {
      const skill = skills[item.name];
      return `<tr class="entry-skill-row" role="row"><td role="cell">${skillLink(item.name)}<small>${esc(skill?.categoryZh || '')}</small></td><td role="cell">${essence ? esc(item.transferable ? '可转授' : item.restriction) : item.level < 1 ? '初始自带' : 'Lv.' + item.level}</td><td role="cell">${esc(skill?.effectZh || '专用技能')}<small>${esc(skill?.costZh || '')}</small></td><td role="cell">${addSkill(item.name, !essence || item.transferable)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function resists(demon) {
    return GameSite.skillUI.resists(demon);
  }
  function affinities(demon) {
    const {potentialElements,categories,symbol} = GameSite.skillUI;
    return `<div class="affinity-grid">${potentialElements.map((element,index) => {
      const value = demon.affinities[index];
      const text = Number.isFinite(value) ? (value > 0 ? '+' : '') + value : '—';
      return `<div data-affinity="${element}">${symbol(element)}<span>${categories[element]}</span><b class="affinity-value ${value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'}">${text}</b></div>`;
    }).join('')}</div>`;
  }
  function ailments(demon) {
    const {ailmentCategories,ailmentSymbol} = GameSite.skillUI;
    if (typeof demon.ailments !== 'string' || demon.ailments.length !== 6) return '<p class="muted">异常耐性数据暂不可用</p>';
    const labels = {'-':'普通',w:'弱',s:'耐',n:'无效'};
    return `<div class="ailment-grid">${Object.entries(ailmentCategories).map(([element,label],index) => {
      const grade = demon.ailments[index];
      return `<div data-ailment="${element}">${ailmentSymbol(element)}<span>${label}</span><b class="${grade === 'w' ? 'weak' : grade === '-' ? '' : 'strong'}">${labels[grade] || '—'}</b></div>`;
    }).join('')}</div>`;
  }
  async function skillEntry() {
    const skill = await fetchJson('/api/skill?name=' + encodeURIComponent(name), '技能资料读取失败');
    skills[name]=skill;GameSite.skillUI.skills.set(name,skill);
    const innate = skill.element === 'innate';
    document.title = skill.label + ' · 技能资料 · 真女5复仇';
    content.innerHTML = heading(skill.label, '技能资料 / ' + skill.categoryZh, addSkill(name, true, true)) +
      facts([['类别',skill.categoryZh], ['作用对象',skill.targetZh], ['基础消耗',skill.costZh], ['继承',skill.restriction]]) +
      section('技能效果', `<p class="entry-effect">${esc(skill.effectZh)}</p>${skill.detailZh ? `<p class="muted">${esc(skill.detailZh)}</p>` : ''}`) +
      `<div class="entry-columns">${section((innate ? '持有仲魔' : '习得仲魔') + ' <small>' + skill.demons.length + '</small>', skill.demons.length ? `<table class="entry-source"><thead><tr><th>仲魔</th><th>${innate ? '持有方式' : '习得'}</th></tr></thead><tbody>${skill.demons.map(d => `<tr><td>${demonLink(d.name)}<small>${esc(d.race)}</small></td><td>${innate ? '固有自带' : d.initial ? '初始自带' : 'Lv.' + d.level}<small>${esc(d.unlock)}</small></td></tr>`).join('')}</tbody></table>` : empty('没有普通仲魔习得来源。'))}
      ${innate ? section('继承限制', '<p class="entry-effect">固有技能由对应仲魔固定持有，不占普通技能栏位，不能通过合体继承或灵体转授。</p>') : section('灵体来源 <small>' + skill.essences.length + '</small>', skill.essences.length ? `<table class="entry-source"><thead><tr><th>灵体</th><th>转授限制</th></tr></thead><tbody>${skill.essences.map(e => `<tr><td>${link('essence',e.name,e.label)}</td><td>${esc(e.transferable ? '可转授给仲魔' : e.restriction)}</td></tr>`).join('')}</tbody></table>` : empty('当前资料没有对应灵体。'))}</div>` +
      `<p class="entry-note">${esc(skill.translationNote)}${innate ? '' : ' 消耗与数值为基础数据，实际效果受适合度等因素影响。'}</p>`;
  }
  function demonEntry(data) {
    const demon = Object.hasOwn(demons,name) ? demons[name] : null;
    if (!demon) throw Error('没有找到该仲魔');
    document.title = demon.label + ' · 仲魔全书 · 真女5复仇';
    const essence = data.essences.find(item => item.name === name);
    const statNames = ['HP','MP','力','体','魔','速','运'];
    const stats = `<div class="entry-stat-grid">${statNames.map((label, i) => `<div><small>${label}</small><strong>${demon.stats[i]}</strong></div>`).join('')}</div>`;
    const method = demon.accident ? '合体事故' : demon.special.length ? '特殊合体' : '普通合体';
    content.innerHTML = heading(demon.label, '仲魔全书 / ' + demon.raceLabel, planTarget(name),
      facts([['种族',demon.raceLabel], ['基础等级','Lv.' + demon.level], ['合体方式',method], ['基准召唤价',demon.basePrice.toLocaleString(SmtvvI18n.locale) + ' 魔货']]), demonUI.profile(demon)) +
      `<div class="entry-traits"><div class="entry-columns">${section('基础能力', stats + `${GameSite.skillUI.innate(demon,from)}`)}<div class="entry-resistances">${section('属性耐性', resists(demon))}${section('异常耐性', ailments(demon))}</div></div>` +
      section('初始技能适合度', affinities(demon)) + '</div>' +
      section('习得技能', skillRows(Object.entries(demon.skills).map(([id, level]) => ({name:id, level})))) +
      (demon.unlock ? section('解锁条件', `<p>${esc(demon.unlock)}</p>`) : '') +
      (demon.special.length ? section('特殊合体材料', `<div class="entry-recipe">${demon.special.map(demonLink).join('<span class="muted">＋</span>')}<span class="muted">→</span>${demonLink(name)}</div>`) : '') +
      (essence ? section('对应灵体', `${link('essence',essence.name,essence.label)}<small> · ${essence.skills.length} 个技能</small>`) : '') +
      `<p class="entry-note">能力与召唤价为数据库基础值。${demon.dlc ? '包含付费 DLC 内容。' : ''}</p>`;
  }
  async function essenceEntry(data) {
    const essence = data.essences.find(item => item.name === name);
    if (!essence) throw Error('没有找到该灵体');
    // Protagonist-only skills are supplied by the detail API, outside the demon catalog.
    const missing = essence.skills.filter(skill => !skills[skill.name]);
    const details = await Promise.all(missing.map(async item => {
      return fetchJson('/api/skill?name=' + encodeURIComponent(item.name), '灵体技能资料读取失败');
    }));
    details.forEach(skill => { skills[skill.name] = skill; GameSite.skillUI.skills.set(skill.name,skill); });
    const groups = {demon:'仲魔灵体',aogami:'青神灵体',tsukuyomi:'月读灵体',other:'其他灵体'};
    document.title = essence.label + ' · 灵体技能表 · 真女5复仇';
    content.innerHTML = heading(essence.label, '灵体技能表 / ' + groups[essence.group]) +
      facts([['类型',groups[essence.group]], ['包含技能',essence.skills.length], ['可转授技能',essence.skills.filter(skill => skill.transferable).length]]) +
      section('灵体技能', skillRows(essence.skills, true)) +
      (demons[name] ? section('对应仲魔', demonLink(name)) : '') +
      `<p class="entry-note">转授范围以各技能的专用限制为准。合体规划中的综合路线默认拥有全部灵体且灵体免费。</p>`;
  }
  async function load() {
    back.href = '/?tab=' + from;
    let previous;
    try { previous = new URL(document.referrer); } catch {}
    const sameSite = previous?.origin === location.origin && ['/', '/index.html', '/demon.html', '/skill.html', '/essence.html'].includes(previous.pathname);
    const previousKind = previous?.pathname.match(/^\/(demon|skill|essence)\.html$/)?.[1];
    const backLabel = sameSite && previousKind ? {demon:'仲魔详情',skill:'技能详情',essence:'灵体详情'}[previousKind] : tabs[from];
    back.innerHTML = icon('ArrowLeft') + ' 返回' + backLabel;
    back.onclick = event => {
      if (sameSite && history.length > 1 && !event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); history.back(); }
    };
    const active = document.querySelector(`[data-tab="${tab}"]`);
    active.classList.add('active'); active.setAttribute('aria-current','page');
    try {
      const data = await catalog;
      demons = Object.fromEntries(data.demons.map(demon => [demon.name, demon]));
      skills = Object.fromEntries(data.skills.map(skill => [skill.name, skill]));
      if (kind === 'skill') await skillEntry();
      else if (kind === 'demon') demonEntry(data);
      else await essenceEntry(data);
      document.body.dataset.catalogState = 'ready';
    } catch (error) {
      document.body.dataset.catalogState = 'error';
      content.innerHTML = `<h1>资料暂不可用</h1><p class="error">${esc(error.message)}</p><p><button id="retry-entry" class="secondary" type="button">重新加载资料</button> <a href="/?tab=${tab}">返回${tabs[tab]}</a></p>`;
      document.getElementById('retry-entry').onclick = () => location.reload();
    } finally {
      content.setAttribute('aria-busy', 'false');
    }
  }
  load();
})();
