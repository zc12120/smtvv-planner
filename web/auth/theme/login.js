'use strict';
(() => {
  SmtvvI18n.ready.then(() => {
    const control = document.getElementById('login-language') || document.createElement('div');
    control.className = 'login-language';
    if (!control.isConnected) document.body.append(control);
    SmtvvI18n.mount(control);
  });
  const $ = id => document.getElementById(id);
  const storageKey = 'smtvv-login-preferences-v1';
  let settings, turnstileSettings = {enabled:false}, busy = false;
  let turnstileWidget = null, turnstileToken = '', turnstileLoader, turnstileSize, turnstileGeneration = 0;
  const readPreferences = () => {try {return JSON.parse(localStorage.getItem(storageKey)) || {};} catch {return {};}};
  const duration = minutes => minutes % 1440 === 0 ? `${minutes / 1440} 天` : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
  const feedback = text => {$('login-feedback').textContent = text;$('login-feedback').hidden = !text;};
  function targetURL() {
    try {
      const target = new URL(new URLSearchParams(location.search).get('rd') || '/', location.origin);
      if (target.origin === location.origin && !target.pathname.startsWith('/auth') && !target.username && !target.password) return target.href;
    } catch {}
    return location.origin + '/';
  }
  async function request(path, data) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {cache:'no-store', credentials:'same-origin', signal:controller.signal,
        ...(data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
      let body;try {body = await response.json();} catch {}
      if (!response.ok) throw Object.assign(Error(body?.error || (response.status === 401 ? '账号或密码不正确，请重新输入。' : response.status === 429 ? '登录尝试过于频繁，请稍后重试。' : '登录服务暂时不可用，请稍后重试。')), {status:response.status});
      if (!body || typeof body !== 'object') throw Error('登录服务返回异常，请重新连接。');
      return body;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('连接超时，请重试。');
      if (error instanceof TypeError) throw Error('暂时无法连接登录服务，请检查网络。');
      throw error;
    } finally {clearTimeout(timer);}
  }
  function updateSubmit() {
    $('sign-in-button').disabled = busy || !settings || (turnstileSettings.enabled && !turnstileToken);
  }
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => failed(),12000);
      function failed() {clearTimeout(timer);script.onload=script.onerror=null;turnstileLoader=undefined;script.remove();reject(Error('人机验证资源加载失败。'));}
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload = () => {clearTimeout(timer);if (window.turnstile) resolve(window.turnstile);else failed();};
      script.onerror = failed;
      document.head.append(script);
    });
    return turnstileLoader;
  }
  function verificationState(state, message) {
    $('turnstile-section').dataset.state = state;
    $('turnstile-state').textContent = message;
    // Older markup can still be in flight while static assets are replaced.
    if ($('retry-turnstile')) $('retry-turnstile').hidden = state !== 'error';
  }
  function widgetSize() { return $('turnstile-widget').clientWidth < 300 ? 'compact' : 'flexible'; }
  function clearTurnstile(message = '正在安全验证…', state = 'loading') {
    turnstileToken = '';
    if (turnstileSettings.enabled) verificationState(state, message);
    updateSubmit();
  }
  function resetTurnstile(message) {
    clearTurnstile(message);
    if (turnstileWidget !== null && window.turnstile) {
      try {window.turnstile.reset(turnstileWidget);} catch {}
    }
  }
  async function setupTurnstile() {
    const generation = ++turnstileGeneration;
    $('turnstile-section').hidden = !turnstileSettings.enabled;
    if (!turnstileSettings.enabled) {turnstileToken = '';updateSubmit();return;}
    $('turnstile-section').dataset.appearance = turnstileSettings.appearance;
    $('turnstile-section').dataset.interactive = 'false';
    turnstileSize = widgetSize();
    $('turnstile-section').dataset.size = turnstileSize;
    clearTurnstile();
    try {
      const api = await loadTurnstile();
      if (generation !== turnstileGeneration) return;
      if (turnstileWidget !== null) api.remove(turnstileWidget);
      // Automatic verification colors follow the current SMT V appearance.
      const theme = turnstileSettings.theme === 'auto'
        ? (getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 'dark' : 'light')
        : turnstileSettings.theme;
      turnstileWidget = api.render('#turnstile-widget', {sitekey:turnstileSettings.siteKey,
        theme,size:turnstileSize,appearance:turnstileSettings.appearance,action:'login',
        language:({'zh-Hans':'zh-CN','zh-Hant':'zh-TW'})[SmtvvI18n.locale] || SmtvvI18n.locale,
        callback:token => {if (generation !== turnstileGeneration) return;turnstileToken=token;$('turnstile-section').dataset.interactive='false';verificationState('verified','安全验证已通过');updateSubmit();},
        'before-interactive-callback':() => {if (generation !== turnstileGeneration) return;$('turnstile-section').dataset.interactive='true';clearTurnstile('请完成下方验证','interactive');},
        'after-interactive-callback':() => {if (generation !== turnstileGeneration) return;$('turnstile-section').dataset.interactive='false';if (!turnstileToken) clearTurnstile();},
        'expired-callback':() => generation === turnstileGeneration && clearTurnstile('验证已过期，请重试','error'),
        'timeout-callback':() => generation === turnstileGeneration && clearTurnstile('验证超时，请重试','error'),
        'error-callback':() => {if (generation !== turnstileGeneration) return true;clearTurnstile('验证暂不可用','error');return true;}});
    } catch {if (generation === turnstileGeneration) clearTurnstile('验证暂不可用','error');}
  }
  window.addEventListener('smtvv:login-theme',() => {
    if (!busy && turnstileSettings.enabled && turnstileSettings.theme === 'auto') setupTurnstile();
  });
  function resizeTurnstile() {
    if (!busy && turnstileSettings.enabled && turnstileWidget !== null &&
        $('turnstile-widget').clientWidth > 0 && widgetSize() !== turnstileSize) setupTurnstile();
  }
  function applySettings(next, turnstile) {
    settings = next;
    turnstileSettings = turnstile || {enabled:false};
    const preferences = readPreferences();
    $('remember-login-option').hidden = !settings.rememberMeEnabled;
    $('remember-login').checked = settings.rememberMeEnabled && (typeof preferences.keepLoggedIn === 'boolean' ? preferences.keepLoggedIn : settings.rememberMeDefault);
    $('remember-duration').textContent = duration(settings.rememberMinutes);
    $('remember-login-option').title = `关闭浏览器后仍保持登录 ${duration(settings.rememberMinutes)}`;
    $('remember-password-option').hidden = !settings.rememberPasswordEnabled;
    if ($('login-options')) $('login-options').hidden = !settings.rememberMeEnabled && !settings.rememberPasswordEnabled;
    $('remember-password').checked = settings.rememberPasswordEnabled && preferences.rememberPassword === true;
    $('password-textfield').autocomplete = settings.rememberPasswordEnabled ? 'current-password' : 'off';
    if ($('remember-password').checked && typeof preferences.username === 'string' && !$('username-textfield').value) $('username-textfield').value = preferences.username;
    updateSubmit();
  }
  async function restorePassword() {
    if (!$('remember-password').checked || !window.PasswordCredential || !navigator.credentials?.get) return;
    try {
      const credential = await navigator.credentials.get({password:true, mediation:'silent'});
      // Do not overwrite anything the user has already typed.
      if (credential?.type === 'password' && !$('password-textfield').value && !busy &&
          !['username-textfield','password-textfield'].includes(document.activeElement?.id) &&
          (!$('username-textfield').value || $('username-textfield').value === credential.id)) {
        $('username-textfield').value = credential.id;
        $('password-textfield').value = credential.password;
      }
    } catch { /* Standard browser autocomplete remains available. */ }
  }
  async function rememberChoices(username, password) {
    const rememberPassword = settings.rememberPasswordEnabled && $('remember-password').checked;
    // Store preferences and, with consent, the username only. Passwords and
    // session cookies never enter localStorage/sessionStorage.
    try {localStorage.setItem(storageKey, JSON.stringify({keepLoggedIn:settings.rememberMeEnabled && $('remember-login').checked,
      rememberPassword, ...(rememberPassword ? {username} : {})}));} catch {}
    if (rememberPassword && window.PasswordCredential && navigator.credentials?.store) {
      try {
        const credential = new PasswordCredential({id:username, password});
        await Promise.race([navigator.credentials.store(credential), new Promise(resolve => setTimeout(resolve, 1200))]);
      } catch { /* The browser decides whether to offer password saving. */ }
    } else if (!rememberPassword && navigator.credentials?.preventSilentAccess) {
      navigator.credentials.preventSilentAccess().catch(() => {});
    }
  }
  async function load() {
    if (busy) return;
    busy = true;$('login-fields').disabled = true;$('retry-login').hidden = true;$('login-loading').hidden = false;feedback('');
    try {
      const [options, state] = await Promise.all([request('/api/login/options'), request('/auth/api/state')]);
      applySettings(options.settings, options.turnstile);
      const authenticated = state.data?.authentication_level >= 1;
      $('login-view').hidden = authenticated;$('authenticated-view').hidden = !authenticated;
      if (authenticated) {
        $('authenticated-username').textContent = state.data.username || '当前账户';
        $('continue-link').href = targetURL();
        if (new URLSearchParams(location.search).has('rd')) location.replace(targetURL());
      } else await setupTurnstile();
    } catch (error) {feedback(error.message);$('retry-login').hidden = false;}
    finally {busy = false;$('login-loading').hidden = true;$('login-fields').disabled = !settings;updateSubmit();resizeTurnstile();}
    if (settings && !$('login-view').hidden) restorePassword();
  }
  if ($('retry-turnstile')) $('retry-turnstile').onclick = () => {if (!busy) setupTurnstile();};
  if (window.ResizeObserver) new ResizeObserver(resizeTurnstile).observe($('turnstile-widget'));
  $('show-login-password').onclick = () => {
    const visible = $('password-textfield').type === 'password';
    $('password-textfield').type = visible ? 'text' : 'password';
    $('show-login-password').textContent = visible ? '隐藏' : '显示';
    $('show-login-password').setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    $('show-login-password').setAttribute('aria-pressed', String(visible));
  };
  $('form-login').onsubmit = async event => {
    event.preventDefault();if (busy || !settings) return;
    if (turnstileSettings.enabled && !turnstileToken) {feedback('请先完成人机验证。');return;}
    busy = true;feedback('');$('retry-login').hidden = true;$('login-fields').disabled = true;$('sign-in-button').textContent = '正在登录…';
    const username = $('username-textfield').value.trim(), password = $('password-textfield').value;
    try {
      if (turnstileSettings.enabled) {
        await request('/api/login/turnstile', {token:turnstileToken});
        turnstileToken = '';
      }
      await request('/auth/api/firstfactor', {username, password, keepMeLoggedIn:settings.rememberMeEnabled && $('remember-login').checked,
        targetURL:targetURL(), requestMethod:'GET'});
      await rememberChoices(username, password);
      location.assign(targetURL());
    } catch (error) {feedback(error.message);resetTurnstile();if (error.status !== 401 && error.status !== 429 && error.status !== 403) $('retry-login').hidden = false;}
    finally {busy = false;$('login-fields').disabled = false;$('sign-in-button').textContent = '登录';updateSubmit();resizeTurnstile();}
  };
  $('logout-button').onclick = async () => {
    if (busy) return;busy = true;$('logout-button').disabled = true;feedback('');
    try {
      await request('/auth/api/logout', {});
      $('password-textfield').value = '';
      if (navigator.credentials?.preventSilentAccess) navigator.credentials.preventSilentAccess().catch(() => {});
      location.replace('/auth/');
    } catch (error) {feedback(error.message);}
    finally {busy = false;$('logout-button').disabled = false;}
  };
  $('retry-login').onclick = load;
  load();
})();
