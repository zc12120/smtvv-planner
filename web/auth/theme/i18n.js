'use strict';
// Localize presentation only. Canonical names, form values, API requests and
// saved route objects must remain identical in every language.
(() => {
  const languages = {'zh-Hans':['简体中文','简中'],en:['English','EN'],ja:['日本語','JA'],'zh-Hant':['繁體中文','繁中'],ko:['한국어','KO']};
  const version = 'worlds-20260914-1';
  const interfaceVersion = 'mobile-core-20261001';
  const storageKey = 'smtvv-language';
  const valid = value => Object.hasOwn(languages, value);
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch {}
  const requested = new URLSearchParams(location.search).get('lang');
  let locale = valid(requested) ? requested : valid(saved) ? saved : 'zh-Hans';
  try { if (valid(requested)) localStorage.setItem(storageKey,locale); } catch {}
  let messages = {}, aliases = {}, game = {}, patterns = [], observer;
  const cache = new Map(), missing = new Set(), loads = new Map();
  const attributes = ['title','aria-label','placeholder','alt','data-tooltip'];
  const skip = 'script,style,code,pre,textarea,[contenteditable],[data-i18n-skip]';
  const escapeRE = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  document.documentElement.lang = locale;

  async function json(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, {signal:controller.signal, credentials:'same-origin'});
        if (!response.ok) throw Error('Language resource HTTP ' + response.status);
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid language resource');
        return data;
      } catch (error) {
        if (attempt) throw error;
      } finally { clearTimeout(timer); }
    }
  }
  function load(language) {
    if (language === 'zh-Hans') return Promise.resolve({});
    if (!loads.has(language)) loads.set(language, json('/auth/theme/locales/' + language + '.json?v=' + interfaceVersion).catch(error => {loads.delete(language);throw error;}));
    return loads.get(language);
  }
  function compile() {
    cache.clear(); missing.clear();
    patterns = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
      const parts = key.split(/(\{\d+\})/), indexes = [];
      const expression = parts.map(part => {
        const match = part.match(/^\{(\d+)\}$/);
        if (!match) return escapeRE(part);
        indexes.push(Number(match[1])); return '([\\s\\S]*?)';
      }).join('');
      return {re:new RegExp('^' + expression + '$'), indexes, value, weight:key.replace(/\{\d+\}/g,'').length};
    }).sort((a,b) => b.weight-a.weight);
  }
  function translate(value, depth = 0) {
    const source = normalize(value);
    if (locale === 'zh-Hans' || !source || depth > 8) return source;
    if (cache.has(source)) return cache.get(source);
    let result = aliases[source] ?? messages[source];
    if (result === undefined && /[\u3400-\u9fff]/.test(source)) {
      for (const pattern of patterns) {
        const match = source.match(pattern.re);
        if (!match) continue;
        const values = {};
        pattern.indexes.forEach((index, n) => {values[index] = translate(match[n+1],depth+1);});
        result = pattern.value.replace(/\{(\d+)\}/g,(_,index) => values[index] ?? '');
        break;
      }
      // These separators delimit independent UI labels and numeric notes.
      // Never substitute individual characters inside names or descriptions.
      if (result === undefined && /(?: · | \/ |；)/.test(source)) {
        const parts = source.split(/( · | \/ |；)/);
        if (parts.length > 1) result = parts.map((part,index) => index%2 ? (part==='；' ? '; ' : part) : translate(part,depth+1)).join('');
      }
      if (result === undefined && /[：:]\s*/.test(source)) {
        const index = source.search(/[：:]/);
        const left = source.slice(0,index), right = source.slice(index+1);
        const translated = aliases[left] ?? messages[left];
        if (translated !== undefined) result = translated + (locale==='en'?': ':'：') + translate(right,depth+1);
      }
      // Text exporters put a localized demon name before a canonical condition.
      if (result === undefined && source.includes(': ')) {
        const [left,...rest]=source.split(': '), right=rest.join(': ');
        if (Object.hasOwn(aliases,right)||Object.hasOwn(messages,right)) result=left+': '+translate(right,depth+1);
      }
    }
    if (result === undefined) result = source;
    if (result === source && /[\u3400-\u9fff]/.test(source) && !Object.hasOwn(messages,source) && !Object.hasOwn(aliases,source)) missing.add(source);
    if (cache.size > 20000) cache.clear();
    cache.set(source,result);
    return result;
  }
  function text(value) {
    const source = String(value ?? '');
    if (locale === 'zh-Hans') return source;
    const core = source.trim();
    if (!core) return source;
    return source.slice(0,source.indexOf(core)) + translate(core) + source.slice(source.indexOf(core)+core.length);
  }
  function visit(element) {
    if (!element || element.nodeType !== 1 || element.matches(skip) || element.closest('[data-i18n-skip]')) return;
    for (const attr of attributes) {
      if (!element.hasAttribute(attr)) continue;
      const before = element.getAttribute(attr), after = text(before);
      if (before !== after) element.setAttribute(attr,after);
    }
  }
  function render(root = document.documentElement) {
    if (locale === 'zh-Hans') return;
    visit(root);
    const walker = document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
      acceptNode(node) {
        const element = node.nodeType===1 ? node : node.parentElement;
        return !element || element.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node=walker.nextNode())) {
      if (node.nodeType===1) visit(node);
      else {
        const after = text(node.nodeValue);
        if (after !== node.nodeValue) node.nodeValue = after;
      }
    }
  }
  function observe() {
    if (observer) observer.disconnect();
    render();
    observer = new MutationObserver(records => {
      const roots = new Set();
      for (const record of records) {
        if (record.type==='attributes') visit(record.target);
        else if (record.type==='characterData') {
          if (record.target.parentElement?.closest(skip)) continue;
          const after = text(record.target.nodeValue);
          if (after !== record.target.nodeValue) record.target.nodeValue=after;
        } else for (const node of record.addedNodes) {
          if (node.nodeType===1) roots.add(node);
          else if (node.nodeType===3 && !node.parentElement?.closest(skip)) {
            const after=text(node.nodeValue);if(after!==node.nodeValue)node.nodeValue=after;
          }
        }
      }
      for (const root of roots) if (!root.parentElement || ![...roots].some(other => other!==root && other.contains(root))) render(root);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
  }
  const ready = load(locale).then(data => {messages=data;compile();observe();}).catch(() => {
    locale='zh-Hans';document.documentElement.lang=locale;
    document.documentElement.dataset.languageError='true';
    observe();
  });
  let gameReady;
  async function catalog(data) {
    await ready;
    if (locale==='zh-Hans') return data;
    if (!gameReady) gameReady=json('/assets/locales/'+locale+'.json?v='+version).then(pack => {
      if (pack.language!==locale || !pack.demons || !pack.skills || !pack.essences) throw Error('Invalid game language pack');
      game=pack;aliases=pack.aliases||{};cache.clear();
    }).catch(() => {document.documentElement.dataset.gameLanguageError='true';});
    await gameReady;
    const localized = structuredClone(data);
    localized.locale=locale;
    for (const demon of localized.demons || []) {
      const local=game.demons?.[demon.name];
      demon.searchAliases=[demon.label,demon.name,demon.raceLabel,demon.race,...(local?.aliases||[]),...(local?.raceAliases||[])].join(' ');
      if (local) {
        demon.label=local.name;demon.descriptionZh=local.description;
        demon.raceLabel=game.races?.[demon.race]||text(demon.raceLabel);
      } else if (locale==='en') {demon.label=demon.name;demon.raceLabel=demon.race;demon.descriptionZh='';}
      demon.innate=game.skills?.[demon.innateId]?.name || text(demon.innate);
      demon.unlock=text(demon.unlock);
    }
    for (const skill of [...(localized.skills||[]),...(localized.innateSkills||[])]) localizeSkill(skill);
    for (const essence of localized.essences||[]) {
      const local=game.essences?.[essence.name];
      essence.searchAliases=[essence.label,essence.name,...(local?.aliases||[])].join(' ');
      essence.label=local?.name || text(essence.label);
      for (const skill of essence.skills) localizeSkill(skill);
    }
    render();
    return localized;
  }
  function localizeSkill(skill) {
    if (locale==='zh-Hans') return skill;
    const local=game.skills?.[skill.name];
    skill.searchAliases=[skill.label,skill.name,...(local?.aliases||[])].join(' ');
    if (local) {
      skill.label=local.name;
      skill.effectZh=local.effect;
      skill.translationNote=text('技能说明采用本地游戏文本，数值按基础数据展开。');
    } else if (locale==='en') skill.label=skill.name;
    for (const key of ['categoryZh','targetZh','costZh','detailZh','restriction']) if (typeof skill[key]==='string') skill[key]=text(skill[key]);
    for (const demon of skill.demons||[]) {
      demon.label=game.demons?.[demon.name]?.name||text(demon.label);
      demon.race=text(demon.race);demon.unlock=text(demon.unlock);
    }
    for (const essence of skill.essences||[]) {
      essence.label=game.essences?.[essence.name]?.name||text(essence.label);
      essence.restriction=text(essence.restriction);
    }
    return skill;
  }
  function mount(container, icon = '') {
    if (!container || container.querySelector('.language-picker')) return;
    const picker=document.createElement('div');picker.className='language-picker';picker.dataset.i18nSkip='';
    const button=document.createElement('button');button.id='site-language';button.type='button';button.className='language-trigger icon-button';
    button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','language-options');
    button.setAttribute('aria-label',text('语言')+' / Language');
    button.innerHTML=icon+'<span>'+languages[locale][1]+'</span>';
    const options=document.createElement('div');options.id='language-options';options.className='language-options';options.setAttribute('role','listbox');options.setAttribute('aria-label','Language');options.hidden=true;
    for (const [key,[label]] of Object.entries(languages)) {
      const option=document.createElement('button');option.type='button';option.lang=key;option.dataset.language=key;
      option.textContent=label;option.setAttribute('role','option');option.setAttribute('aria-selected',String(key===locale));
      option.onclick=async () => {
        if (key===locale) {close();return;}
        option.disabled=true;
        try {
          await load(key);
          window.persistDesktopState?.();
          // Persisting is helpful, but a blocked/full store must not disable language selection.
          try {localStorage.setItem(storageKey,key);} catch {}
          const url=new URL(location.href);url.searchParams.set('lang',key);location.assign(url.href);
        } catch {
          option.disabled=false;status.textContent=text('语言资源暂时无法加载，请重试。');status.hidden=false;
        }
      };
      options.append(option);
    }
    const status=document.createElement('p');status.className='language-status';status.setAttribute('role','status');status.hidden=true;
    const close=() => {options.hidden=true;button.setAttribute('aria-expanded','false');};
    button.onclick=() => {
      options.hidden=!options.hidden;button.setAttribute('aria-expanded',String(!options.hidden));
      if (!options.hidden) options.querySelector('[aria-selected="true"]').focus();
    };
    options.addEventListener('keydown',event => {
      const items=[...options.querySelectorAll('button')],index=items.indexOf(document.activeElement);
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
      } else if (event.key==='Escape') {event.preventDefault();close();button.focus();}
    });
    picker.addEventListener('focusout',event => {if (!picker.contains(event.relatedTarget))close();});
    document.addEventListener('pointerdown',event => {if(!picker.contains(event.target))close();});
    picker.append(button,options,status);container.append(picker);
    if (document.documentElement.dataset.languageError) {status.textContent='语言资源暂时无法加载，请重新选择语言。';status.hidden=false;}
  }
  window.SmtvvI18n={get locale(){return locale;},languages,ready,text,render,catalog,skill:localizeSkill,mount,missing};
})();
