'use strict';
(() => {
  const read = (key, fallback = null) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const icons = new Map();
  const icon = name => {
    if (icons.has(name)) return icons.get(name);
    const element = lucide.createElement(lucide.icons[name]);
    element.setAttribute('class', 'icon');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('focusable', 'false');
    const markup = element.outerHTML;
    icons.set(name, markup);
    return markup;
  };
  const normalizeSearch = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  const searchableNames = new WeakMap();
  function matchesName(item, query) {
    if (!query) return true;
    if (!searchableNames.has(item)) {
      searchableNames.set(item, [item.name,item.label,item.searchAliases,item.aliases]
        .filter(Boolean).map(normalizeSearch));
    }
    return searchableNames.get(item).some(name => name.includes(query));
  }
  const searchable = new WeakMap();
  function matchesQuery(item, query) {
    if (!query) return true;
    if (!searchable.has(item)) {
      const skills = Array.isArray(item.skills) ? item.skills.map(skill => `${skill.name} ${skill.label} ${skill.searchAliases || ''}`).join(' ') : '';
      searchable.set(item, normalizeSearch([item.name,item.label,item.searchAliases,item.aliases,
        item.raceLabel,item.effectZh,item.detailZh,skills].filter(Boolean).join(' ')));
    }
    return searchable.get(item).includes(query);
  }
  function bindSearch(input, render) {
    // Enter and provisional input from an IME must not select/filter half a word.
    input.oninput = event => { if (!event.isComposing) render(); };
    input.addEventListener('compositionend', render);
  }
  const tabs = {planner:'合体规划', demons:'仲魔全书', skills:'技能资料', essences:'灵体技能表'};
  const portraits = new Map();
  const portraitSizes = new Set(['small', 'card', 'hero', 'detail', 'route']);
  const portraitPath = value => typeof value === 'string' && /^\/assets\/demons\/[a-z0-9-]+\.png$/.test(value) ? value : null;
  const displayPath = value => typeof value === 'string' && /^\/assets\/demons\/display\/[a-z0-9-]+\.png$/.test(value) ? value : null;
  const optimizedPath = value => typeof value === 'string' && /^\/assets\/demons\/optimized\/[a-z0-9-]+-[a-f0-9]{12}-\d+\.webp$/.test(value) ? value : null;
  const responsivePortraits = new WeakMap();
  function variants(portrait) {
    if (!responsivePortraits.has(portrait)) {
      const list = portrait.optimized?.format === 'webp' && Array.isArray(portrait.optimized.variants) ? portrait.optimized.variants : [];
      responsivePortraits.set(portrait,list.filter(item => item && optimizedPath(item.src) && Number.isInteger(item.width) && item.width > 0 && item.width <= 4096 && Number.isInteger(item.height) && item.height > 0 && item.height <= 4096).sort((a,b)=>a.width-b.width));
    }
    return responsivePortraits.get(portrait);
  }
  const portraitWidth = (size,loading) => size === 'route' ? '112px' : size === 'detail' || loading === 'eager' ? '224px' : size === 'hero' ? '96px' : '48px';
  const preferredSource = portrait => variants(portrait)[0]?.src || displayPath(portrait.display?.src) || portraitPath(portrait.src);
  let portraitStatus = 'pending';
  function requireLogin() {
    if (document.getElementById('auth-notice')) return;
    const notice = document.createElement('div');
    notice.id = 'auth-notice';
    notice.className = 'auth-notice';
    notice.setAttribute('role', 'alert');
    const message = document.createElement('span');
    message.textContent = '登录已过期。当前配置已保留，登录后可继续。';
    const link = document.createElement('a');
    link.className = 'primary with-icon';
    link.href = '/auth/?rd=' + encodeURIComponent(location.href);
    link.textContent = '重新登录';
    notice.append(message, link);
    (document.querySelector('main') || document.body).prepend(notice);
  }
  function retryDelay(response, attempt = 0) {
    const value = response?.headers.get('Retry-After');
    const seconds = value === null || value === undefined ? NaN : Number(value);
    const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    return Math.min(30000, Math.max(400 * (attempt + 1), Number.isFinite(requested) ? requested : 0));
  }
  async function fetchJsonWithRetry(url, label, attempts = 2, timeout = 12000) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const early = attempt === 0 ? window.smtvvEarlyRequests?.get(url) : null;
        if (early) window.smtvvEarlyRequests.delete(url);
        let response, body;
        if (early) {
          const result = await early;
          if (result.error) throw result.error;
          response = result.response;
          body = result.body;
        } else response = await fetch(url, {signal: controller.signal, ...(attempt ? {cache: 'reload'} : {})});
        if (response.status === 401) {
          requireLogin();
          throw Object.assign(Error('登录已过期，请重新登录。'), {retryable: false, status: 401});
        }
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!early) try { body = await response.json(); } catch {}
        if (!response.ok) {
          const detail = typeof body?.error === 'string' ? body.error : '';
          throw Object.assign(Error(detail || `${label}（HTTP ${response.status}）`), {retryable, delay: retryDelay(response, attempt)});
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(`${label}：返回的数据不完整，请重试。`);
        return String(url).startsWith('/api/skill?') ? SmtvvI18n.skill(body) : body;
      } catch (error) {
        lastError = controller.signal.aborted || error.name === 'AbortError' ? Error(`${label}：连接超时，请重试。`)
          : error instanceof TypeError ? Error(`${label}：暂时无法连接服务，请重试。`) : error;
        if (error.retryable === false) throw lastError;
        clearTimeout(timer);
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, error.delay || 400 * (attempt + 1)));
      } finally { clearTimeout(timer); }
    }
    throw lastError || Error(label);
  }
  function placeholder(name, size, state, track = true, deferred = false) {
    const unavailable = state === 'missing';
    const identity = track ? ` data-demon-portrait="${esc(name)}"` : '';
    return `<span class="demon-portrait demon-portrait--${size} demon-portrait--${unavailable ? 'missing' : 'pending'}"${identity} data-portrait-size="${size}" data-portrait-state="${unavailable ? 'missing' : 'pending'}"${deferred ? ' data-portrait-deferred="true"' : ''} role="img" aria-label="${esc(unavailable ? name + '头像暂不可用' : '正在加载' + name + '头像')}">${icon(unavailable ? 'ImageOff' : 'Image')}</span>`;
  }
  function portraitImage(name, size = 'small', loading = 'lazy') {
    if (!portraitSizes.has(size)) size = 'small';
    const portrait = portraits.get(name);
    if (!portrait) return placeholder(name, size, portraitStatus === 'pending' ? 'pending' : 'missing', portraitStatus === 'pending');
    const display = displayPath(portrait.display?.src);
    const native = portraitPath(portrait.src);
    if (!display && !native) return placeholder(name, size, 'missing');
    const choices = variants(portrait);
    const source = choices[0]?.src || display || native;
    const sourceType = choices.length ? 'optimized' : display ? 'display' : 'native';
    const width = Number((display ? portrait.display : portrait).width) || 512;
    const height = Number((display ? portrait.display : portrait).height) || 256;
    const responsive = choices.length ? ` srcset="${choices.map(item=>esc(item.src)+' '+item.width+'w').join(', ')}" sizes="${portraitWidth(size,loading)}"` : '';
    return `<img class="demon-portrait demon-portrait--${size}${sourceType === 'native' ? ' demon-portrait--native' : ''}" src="${esc(source)}"${responsive} width="${width}" height="${height}" alt="" aria-hidden="true" decoding="async" loading="${loading === 'eager' ? 'eager' : 'lazy'}" data-demon-portrait="${esc(name)}" data-portrait-size="${size}" data-portrait-loading="${loading === 'eager' ? 'eager' : 'lazy'}" data-portrait-source="${sourceType}" data-portrait-base="${esc(source)}" data-portrait-retries="0">`;
  }
  function setPortraitSource(image, portrait, sourceType) {
    const display = displayPath(portrait.display?.src);
    const choices = sourceType === 'optimized' ? variants(portrait) : [];
    const source = choices[0]?.src || (sourceType === 'native' ? portraitPath(portrait.src) : display);
    if (!source) return false;
    const metadata = sourceType === 'native' ? portrait : portrait.display || portrait;
    image.className = `demon-portrait demon-portrait--${image.dataset.portraitSize || 'small'}${sourceType === 'native' ? ' demon-portrait--native' : ''}`;
    image.width = Number(metadata.width) || 512;
    image.height = Number(metadata.height) || 256;
    image.dataset.portraitSource = sourceType;
    image.dataset.portraitBase = source;
    image.dataset.portraitRetries = '0';
    image.dataset.portraitState = 'loading';
    image.hidden = false;
    if (choices.length) {
      image.sizes = portraitWidth(image.dataset.portraitSize,image.dataset.portraitLoading);
      image.srcset = choices.map(item=>item.src+' '+item.width+'w').join(', ');
    } else {
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
    }
    image.src = source;
    return true;
  }
  function hydratePortraits(root = document, force = false) {
    root.querySelectorAll?.('[data-demon-portrait]').forEach(element => {
      const portrait = portraits.get(element.dataset.demonPortrait);
      if (!portrait) {
        if (portraitStatus !== 'pending' && element.dataset.portraitState === 'pending') {
          const missingName = element.dataset.demonPortrait || '';
          element.removeAttribute('data-demon-portrait');
          element.classList.remove('demon-portrait--pending');
          element.classList.add('demon-portrait--missing');
          element.dataset.portraitState = 'missing';
          element.setAttribute('aria-label', `${missingName}头像暂不可用`);
          element.innerHTML = icon('ImageOff');
        }
        return;
      }
      if (element.dataset.portraitState === 'missing') return;
      if (!force && element.dataset.portraitDeferred === 'true') {
        const deferredSource = preferredSource(portrait);
        if (deferredSource) element.setAttribute('src', deferredSource);
        return;
      }
      if (element instanceof HTMLImageElement) {
        // A cached card may have finished loading while detached from document,
        // where the delegated error listener cannot observe its failed request.
        if (element.complete && !element.naturalWidth && element.currentSrc && !element.dataset.portraitRetryPending) {
          handlePortraitError(element);
          return;
        }
        if (element.dataset.portraitState === 'loading' || element.dataset.portraitState === 'loaded') return;
        const expected = preferredSource(portrait);
        if (element.dataset.portraitBase === expected) return;
        setPortraitSource(element, portrait, variants(portrait).length ? 'optimized' : displayPath(portrait.display?.src) ? 'display' : 'native');
        return;
      }
      const wrapper = document.createElement('span');
      wrapper.innerHTML = portraitImage(element.dataset.demonPortrait, element.dataset.portraitSize || 'small', element.dataset.portraitLoading || 'lazy');
      element.replaceWith(wrapper.firstElementChild);
    });
  }
  function markPortraitsUnavailable(root = document) {
    root.querySelectorAll?.('.demon-portrait--pending').forEach(element => {
      const missingName = element.dataset.demonPortrait || '';
      element.classList.remove('demon-portrait--pending');
      element.classList.add('demon-portrait--missing');
      element.dataset.portraitState = 'missing';
      element.removeAttribute('data-demon-portrait');
      element.setAttribute('aria-label', `${missingName}头像暂不可用`);
      element.innerHTML = icon('ImageOff');
    });
  }
  function handlePortraitError(image) {
    if (image.dataset.portraitRetryPending) return;
    const portrait = portraits.get(image.dataset.demonPortrait);
    if (!portrait) { image.replaceWith(document.createTextNode('')); return; }
    const retries = Number(image.dataset.portraitRetries || 0);
    if (retries < 1) {
      image.dataset.portraitRetries = String(retries + 1);
      image.dataset.portraitRetryPending = 'true';
      const base = image.currentSrc || image.dataset.portraitBase || image.src;
      window.setTimeout(() => {
        delete image.dataset.portraitRetryPending;
        if (!image.isConnected) return;
        image.dataset.portraitState = 'retrying';
        image.src = `${base}${base.includes('?') ? '&' : '?'}retry=${Date.now()}`;
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
      }, 220);
      return;
    }
    if (image.dataset.portraitSource === 'optimized' && displayPath(portrait.display?.src)) {
      setPortraitSource(image, portrait, 'display');
      return;
    }
    if (image.dataset.portraitSource !== 'native' && portraitPath(portrait.src)) {
      setPortraitSource(image, portrait, 'native');
      return;
    }
    const size = image.dataset.portraitSize || 'small';
    const replacement = document.createElement('span');
    replacement.className = `demon-portrait demon-portrait--${size} demon-portrait--missing`;
    replacement.dataset.demonPortrait = image.dataset.demonPortrait;
    replacement.dataset.portraitSize = size;
    replacement.dataset.portraitState = 'missing';
    replacement.setAttribute('role', 'img');
    replacement.setAttribute('aria-label', `${image.dataset.demonPortrait || ''}头像暂不可用`);
    replacement.innerHTML = `${icon('ImageOff')}<span class="portrait-placeholder-label">头像暂不可用</span>`;
    image.replaceWith(replacement);
  }
  function retryStaticImage(image) {
    if (!image.src.includes('/assets/') || image.dataset.assetRetries) return;
    image.dataset.assetRetries = '1';
    const base = image.currentSrc || image.src;
    window.setTimeout(() => {
      if (!image.isConnected) return;
      image.src = `${base}${base.includes('?') ? '&' : '?'}retry=${Date.now()}`;
    }, 220);
  }
  const portraitReady = fetchJsonWithRetry('/assets/demons/manifest.json?v=portraits-4&view=runtime', '头像资料读取失败').then(manifest => {
    const entries = [...Object.entries(manifest.demons || {}), ...Object.entries(manifest.essences || {})];
    for (const [name, portrait] of entries) {
      if (portraitPath(portrait?.src)) portraits.set(name, portrait);
    }
    portraitStatus = portraits.size ? 'ready' : 'failed';
  }).catch(error => {
    portraitStatus = 'failed';
    console.warn('仲魔头像暂不可用，文字资料仍可使用。', error);
  }).finally(() => {
    if (portraitStatus === 'ready') hydratePortraits();
    else markPortraitsUnavailable();
    window.dispatchEvent(new Event('smtvv:portraits-ready'));
  });
  function demonProfile(demon, mode = 'full') {
    const paragraphs = String(demon.descriptionZh || '').split(/\n{2,}/).filter(Boolean);
    if (!paragraphs.length) return '';
    const copy = values => `<div class="demon-profile-copy" data-i18n-skip>${values.map(text => `<p>${esc(text)}</p>`).join('')}</div>`;
    const identity = `data-profile-for="${esc(demon.name)}"`;
    if (mode === 'compact') return `<details class="demon-profile demon-profile-collapsible" ${identity}><summary>${icon('BookOpen')}<span>仲魔介绍</span>${icon('ChevronDown')}</summary>${copy(paragraphs)}</details>`;
    if (mode === 'preview') return `<section class="demon-profile demon-profile-preview" ${identity}><h4>仲魔介绍</h4>${copy(paragraphs.slice(0,1))}</section>`;
    return `<section class="entry-section demon-profile demon-profile-full" ${identity}><h2>仲魔介绍</h2>${copy(paragraphs)}</section>`;
  }
  const demonUI = {
    portraits,
    image: portraitImage,
    profile: demonProfile,
    ready: portraitReady,
    hydrate: hydratePortraits,
    identity: (name, content, options = {}) => `<span class="demon-identity">${options.defer ? placeholder(name, options.size || 'small', portraitStatus === 'failed' ? 'missing' : 'pending', portraitStatus !== 'failed', true) : portraitImage(name, options.size || 'small', options.loading || 'lazy')}<span class="demon-identity-text">${content}</span></span>`
  };
  document.addEventListener('error', event => {
    if (!(event.target instanceof HTMLImageElement)) return;
    if (event.target.matches('.demon-portrait')) handlePortraitError(event.target);
    else retryStaticImage(event.target);
  }, true);
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLImageElement && event.target.matches('.demon-portrait')) {
      event.target.dataset.portraitState = 'loaded';
      event.target.dataset.portraitRetries = '0';
    }
  }, true);
  // Version the URL as well as scripts so browser/edge caches cannot restore
  // routes tagged with an older rules version after an application update.
  const catalogData = fetchJsonWithRetry('/api/catalog?v=2026-09-14.2', '资料读取失败').then(data => {
    if (!['demons','skills','essences'].every(key => Array.isArray(data[key])) || typeof data.version !== 'string') throw Error('资料格式不完整，请重新加载。');
    window.GameSite.assets = data.assets || {};
    return SmtvvI18n.catalog(data);
  });
  // Text data is independent from optional artwork so pages remain usable on slow or broken asset requests.
  const catalog = catalogData;
  // Publish a stable placeholder before app.js loads so asynchronous consumers
  // can observe the planner state without racing script initialization.
  window.currentPage = null;
  window.GameSite = {read, write, esc, icon, normalizeSearch, matchesName, matchesQuery, bindSearch, catalog, fetchJson: fetchJsonWithRetry, retryDelay, tabs, demonUI, portraitReady, requireLogin, assets: {}};

  let lastSiteSignature = '';
  function renderSiteState(data) {
    const settings = data?.settings;
    if (!settings || typeof settings !== 'object') return;
    document.getElementById('auth-notice')?.remove();
    const signature = JSON.stringify([settings, data.administrator]);
    if (signature === lastSiteSignature) return;
    lastSiteSignature = signature;
    window.dispatchEvent(new CustomEvent('smtvv:site-state', {detail: data}));
    const notices = [];
    if (settings.maintenance === true) notices.push({kind: 'maintenance', title: '维护模式', body: '暂时停止创建新的计算；已有任务仍可查看。'});
    const notice = settings.notice;
    if (notice?.enabled === true && (String(notice.title || '').trim() || String(notice.body || '').trim())) {
      notices.push({kind: 'notice', title: notice.title || '站点公告', body: notice.body || ''});
    }
    const existing = document.getElementById('site-operations');
    if (!notices.length) { existing?.remove(); return; }
    const container = existing || document.createElement('div');
    container.id = 'site-operations';
    container.className = 'site-operations';
    container.replaceChildren(...notices.map(item => {
      const panel = document.createElement('section');
      panel.className = `site-operation site-operation--${item.kind}`;
      panel.setAttribute('role', item.kind === 'maintenance' ? 'status' : 'region');
      const heading = document.createElement('h2');
      heading.textContent = item.title;
      const body = document.createElement('p');
      body.textContent = item.body;
      if (item.kind === 'notice') { heading.dataset.i18nSkip = ''; body.dataset.i18nSkip = ''; }
      panel.append(heading, body);
      return panel;
    }));
    (document.querySelector('main') || document.body).prepend(container);
  }
  let siteRequest, siteTimer;
  function refreshSiteState() {
    if (siteRequest) return siteRequest;
    clearTimeout(siteTimer);
    siteRequest = fetchJsonWithRetry('/api/site?v=2026-09-12.4', '站点状态读取失败')
      .then(data => { renderSiteState(data); return data; })
      .catch(error => { if (error.status === 401) requireLogin(); return null; })
      .finally(() => {
        siteRequest = null;
        if (!document.hidden) siteTimer = setTimeout(refreshSiteState, 5000);
      });
    return siteRequest;
  }
  window.GameSite.refreshSiteState = refreshSiteState;
  window.GameSite.siteState = refreshSiteState();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(siteTimer);else refreshSiteState();
  });
  window.addEventListener('focus', refreshSiteState);
  window.addEventListener('pageshow', event => { if (event.persisted) refreshSiteState(); });

  document.querySelector('[data-site-header]').innerHTML = `
    <div class="masthead">
      <a class="site-brand" href="/?tab=planner&view=build" title="仲魔配置">
        <img src="/assets/planner-mark.svg" width="666" height="227" alt="真女5复仇 · 合体规划">
      </a>
      <div class="global-search">
        ${icon('Search')}<label class="sr-only" for="global-search">搜索全部资料</label>
        <input id="global-search" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="global-results" aria-autocomplete="list" placeholder="搜索仲魔、技能、灵体">
        <kbd class="search-shortcut" aria-hidden="true">/</kbd>
        <div id="global-results" role="listbox" aria-label="全部资料搜索结果" hidden></div>
      </div>
      <div class="display-controls">
        <div class="appearance-switch" role="group" aria-label="界面风格">
          <button type="button" data-skin-choice="smtv" aria-pressed="true" aria-label="切换为真女神转生V复仇主题">SMT V</button>
          <button type="button" data-skin-choice="p5" aria-pressed="false" aria-label="切换为女神异闻录5主题">P5</button>
          <button type="button" data-skin-choice="p3r" aria-pressed="false" aria-label="切换为女神异闻录3 Reload主题">P3R</button>
        </div>
        <button id="site-font" class="icon-button" type="button" aria-label="大字号" data-tooltip="大字号" aria-pressed="false">${icon('CaseSensitive')}</button>
        <button id="site-theme" class="icon-button" type="button" aria-label="切换深色主题" data-tooltip="切换深色主题">${icon('Moon')}</button>
      </div>
    </div>`;
  document.querySelector('[data-site-nav]').innerHTML = `<div class="nav-inner"><nav aria-label="主导航">${Object.entries(tabs).map(([key,label],index) => `<a href="/?tab=${key}" data-tab="${key}"><span class="nav-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><span>${label}</span></a>`).join('')}</nav><span class="nav-context">VENGEANCE / 全部 DLC</span></div>`;
  document.querySelector('[data-site-nav]').insertAdjacentHTML('afterend', '<div class="reload-banner" aria-hidden="true"><div class="reload-banner-inner"><span class="reload-edition">P3<br>RELOAD</span><div class="reload-wordmark"><strong>RELOAD</strong><span>YOUR NEXT<br>FUSION.</span></div><div class="reload-figure"></div><span class="reload-stamp">PERSONA 3 / VISUAL THEME</span></div></div>');
  document.querySelectorAll('[data-tab]').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (document.getElementById('tab-planner') && !window.persistDesktopState) {
      event.preventDefault();
      window.smtvvPendingTab = link.dataset.tab;
    }
  }));
  document.querySelectorAll('[data-icon]').forEach(element => { element.outerHTML = icon(element.dataset.icon); });

  const themeButton = document.getElementById('site-theme');
  const fontButton = document.getElementById('site-font');
  // A fresh public appearance preference makes the Vengeance redesign the
  // default without changing the login page's or administrator's theme.
  const appearance = read('smtvv-appearance', {});
  function saveAppearance() {
    write('smtvv-appearance', {skin: document.documentElement.dataset.skin, theme: document.documentElement.dataset.theme});
  }
  function skin(value, persist = true) {
    value = ['smtv','p5','p3r'].includes(value) ? value : 'smtv';
    document.documentElement.dataset.skin = value;
    document.querySelectorAll('[data-skin-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.skinChoice === value));
    });
    if (persist) saveAppearance();
  }
  function theme(value, persist = true) {
    value = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = value;
    themeButton.innerHTML = icon(value === 'dark' ? 'Sun' : 'Moon');
    const label = value === 'dark' ? '切换浅色主题' : '切换深色主题';
    themeButton.setAttribute('aria-label', label);
    themeButton.dataset.tooltip = label;
    if (persist) saveAppearance();
  }
  function font(value, persist = true) {
    value = value === 'large' ? 'large' : 'standard';
    document.documentElement.dataset.font = value;
    fontButton.setAttribute('aria-pressed', String(value === 'large'));
    if (persist) write('smtvv-font', value);
  }
  skin(appearance?.skin, false);
  theme(appearance?.theme, false);
  document.querySelectorAll('[data-skin-choice]').forEach(button => {
    button.onclick = () => skin(button.dataset.skinChoice);
  });
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === 'smtvv-appearance') {
      const updated = read('smtvv-appearance', {});
      skin(updated?.skin, false);
      theme(updated?.theme, false);
    }
    if (event.key === null || event.key === 'smtvv-font') font(read('smtvv-font'), false);
  });
  font(read('smtvv-font'), false);
  themeButton.onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  fontButton.onclick = () => font(document.documentElement.dataset.font === 'large' ? 'standard' : 'large');
  SmtvvI18n.mount(document.querySelector('.display-controls'), icon('Languages'));

  const input = document.getElementById('global-search');
  const results = document.getElementById('global-results');
  let index = [];
  catalog.then(data => {
    if (data.assets?.officialLogo) document.querySelector('.site-brand img').src = '/assets/logo.png';
    const title = document.querySelector('.page-title');
    if (data.assets?.officialLogo && title) {
      // Optional artwork is decorative; a missing local resource leaves the
      // complete CSS composition in place and never blocks the planner.
      const artwork = new Image();
      artwork.className = 'page-art-image';
      artwork.alt = '';
      artwork.setAttribute('aria-hidden', 'true');
      artwork.decoding = 'async';
      artwork.onload = () => { if (title.isConnected) title.append(artwork); };
      artwork.onerror = () => { artwork.onerror = null; if (data.assets?.storyArt) artwork.src = '/assets/story-art.webp'; };
      artwork.src = data.assets?.storyArt || '/assets/story-art.webp';
    }
    const skills = new Map([...data.skills, ...(data.innateSkills || [])].map(skill => [skill.name, skill]));
    for (const essence of data.essences) {
      for (const skill of essence.skills) if (!skills.has(skill.name)) skills.set(skill.name, skill);
    }
    index = [
      ...data.demons.map(d => ({kind:'demon', type:'仲魔', name:d.name, label:d.label, aliases:d.searchAliases||'', extra:`Lv.${d.level} · ${d.raceLabel}`})),
      ...[...skills.values()].map(s => ({kind:'skill', type:'技能', name:s.name, label:s.label, aliases:s.searchAliases||'', element:s.element, extra:s.categoryZh || '技能'})),
      ...data.essences.map(e => ({kind:'essence', type:'灵体', name:e.name, label:e.label, aliases:e.searchAliases||'', extra:`${e.skills.length} 个技能`}))
    ];
    if (input.value) search();
  }).catch(() => { input.placeholder = '资料读取失败'; });
  function close() { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  function search() {
    const query = normalizeSearch(input.value);
    if (!query) { close(); return; }
    const found = index.filter(item => item.kind === 'skill' ? matchesName(item, query) : matchesQuery(item, query))
      .sort((a,b) => Number(normalizeSearch(b.label) === query || normalizeSearch(b.name) === query) - Number(normalizeSearch(a.label) === query || normalizeSearch(a.name) === query));
    const from = document.querySelector('[data-tab].active')?.dataset.tab || 'planner';
    results.innerHTML = found.length ? ['demon','skill','essence'].map(kind => {
      const group = found.filter(item => item.kind === kind).slice(0, 5);
      return group.length ? `<div class="search-group-label">${group[0].type}</div>` + group.map(item =>
        `<a role="option" aria-selected="false" href="/${kind}.html?name=${encodeURIComponent(item.name)}&from=${from}"><span class="search-result-name">${kind === 'skill' ? (GameSite.skillUI?.symbol(item.element) || '') : portraitImage(item.name)}${esc(item.label)}</span><small>${esc(item.extra)}</small></a>`
      ).join('') : '';
    }).join('') : '<p>没有匹配的资料</p>';
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  bindSearch(input, search);
  input.onfocus = () => { if (input.value) search(); };
  input.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowDown') { event.preventDefault(); search(); results.querySelector('a')?.focus(); }
    if (event.key === 'Enter' && !results.hidden) { event.preventDefault(); results.querySelector('a')?.click(); }
  };
  results.onkeydown = event => {
    const links = [...results.querySelectorAll('a')];
    const current = links.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      links[(current + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus();
    }
    if (event.key === 'Escape') { input.focus(); close(); }
  };
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.global-search')) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !document.querySelector('dialog[open]') && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      event.preventDefault(); input.focus();
    }
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (link && link.origin === location.origin && link.pathname !== location.pathname) window.persistDesktopState?.();
  }, true);
  window.addEventListener('pagehide', () => window.persistDesktopState?.());
  document.addEventListener('visibilitychange', () => { if (document.hidden) window.persistDesktopState?.(); });
})();
