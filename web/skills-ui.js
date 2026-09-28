'use strict';
(() => {
  const {esc} = GameSite;
  const categories = {phy:'物理',fir:'火炎',ice:'冰结',ele:'电击',for:'冲击',lig:'破魔',dar:'咒杀',alm:'万能',ail:'异常',rec:'回复',sup:'辅助',pas:'被动',spe:'特殊',innate:'固有技能'};
  const potentialElements = ['phy','fir','ice','ele','for','lig','dar','alm','ail','rec','sup'];
  const ailmentCategories = {cha:'魅惑',sea:'封技',pan:'混乱',poi:'中毒',sle:'睡眠',mir:'幻惑'};
  const skills = new Map();
  function symbol(element, size = '') {
    const key = Object.hasOwn(categories, element) ? element : 'spe';
    if (!GameSite.assets.elementIcons) {
      const names = {phy:'Swords',fir:'Flame',ice:'Snowflake',ele:'Zap',for:'Wind',lig:'Sun',dar:'Moon',alm:'Orbit',ail:'Skull',rec:'Heart',sup:'Shield',pas:'Gem',spe:'Sparkles',innate:'Fingerprint'};
      return `<span class="skill-symbol open-symbol ${size}" role="img" aria-label="${categories[key]}" title="${categories[key]}" data-element-icon="${key}">${GameSite.icon(names[key])}</span>`;
    }
    return `<img class="skill-symbol ${size}" src="/assets/elements/${key}.png" width="28" height="28" alt="${categories[key]}" title="${categories[key]}" data-element-icon="${key}">`;
  }
  function label(name, text, element) {
    return `${symbol(element || skills.get(name)?.element)}<span class="skill-name">${esc(text || skills.get(name)?.label || name)}</span>`;
  }
  function ailmentSymbol(element) {
    if (!Object.hasOwn(ailmentCategories,element)) return '';
    if (!GameSite.assets.ailmentIcons) {
      const names = {cha:'HeartCrack',sea:'VolumeX',pan:'Shuffle',poi:'FlaskConical',sle:'Moon',mir:'EyeOff'};
      return `<span class="skill-symbol ailment-symbol open-symbol" role="img" aria-label="${ailmentCategories[element]}" title="${ailmentCategories[element]}" data-ailment-icon="${element}">${GameSite.icon(names[element])}</span>`;
    }
    return `<img class="skill-symbol ailment-symbol" src="/assets/ailments/${element}.png" width="30" height="30" alt="${ailmentCategories[element]}" title="${ailmentCategories[element]}" data-ailment-icon="${element}">`;
  }
  function link(name, text, from = 'planner', classes = '') {
    return `<a class="skill-link ${classes}" href="/skill.html?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}" title="${esc(skills.get(name)?.effectZh || '查看技能详情')}">${label(name,text)}</a>`;
  }
  function resists(demon) {
    const elements = ['phy','fir','ice','ele','for','lig','dar'];
    const labels = {'-':'普通',w:'弱点',s:'耐性',n:'无效',r:'反弹',d:'吸收'};
    return `<div class="resists elemental-grid" role="list" aria-label="属性耐性">${elements.map((element,index) => {
      const code = Object.hasOwn(labels,demon.resists?.[index]) ? demon.resists[index] : '-';
      return `<div class="resist-cell" data-resistance="${code}" data-element="${element}" role="listitem" aria-label="${categories[element]}：${labels[code]}" title="${categories[element]}：${labels[code]}"><span class="resist-icon" aria-hidden="true">${symbol(element)}</span><span class="element-name">${categories[element]}</span><b class="resist-value ${code === 'w' ? 'weak' : code === '-' ? '' : 'strong'}">${code === '-' ? '—' : labels[code]}</b></div>`;
    }).join('')}</div>`;
  }
  function innate(demon, from = 'planner') {
    const skill = skills.get(demon.innateId);
    return `<div class="innate"><div class="innate-heading"><small>固有技能</small><small>不可继承</small></div>${skill ? link(skill.name,skill.label,from) : `<strong>${esc(demon.innate)}</strong>`}<p class="innate-effect">${esc(skill?.effectZh || '效果资料暂不可用')}</p></div>`;
  }
  GameSite.skillUI = {categories, potentialElements, ailmentCategories, skills, symbol, ailmentSymbol, label, link, innate, resists};
  GameSite.catalog.then(data => {
    [...data.skills, ...(data.innateSkills || [])].forEach(skill => skills.set(skill.name, skill));
    data.essences.forEach(essence => essence.skills.forEach(skill => {
      if (!skills.has(skill.name)) skills.set(skill.name, skill);
    }));
  }).catch(() => {});
})();
