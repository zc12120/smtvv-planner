'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusNames = {running:'计算中',queued:'排队中',completed:'已完成',cancelled:'已取消',failed:'未完成'};
  let state, busy = false, refreshing = false, noticeDirty = false, generation = 0, expired = false, leaving = false;
  const pendingReads = new Set();
  let noticeRevision, noticeBase = '';
  let policyDirty = false, policyRevision, policyBase = '';
  let turnstileDirty = false, turnstileRevision, turnstileBase = '', turnstileSecretConfigured = false;
  let turnstileAdminToken = '', turnstileAdminWidget = null, turnstileAdminSiteKey = '', turnstileLoader;
  let widgetGeneration = 0, feedbackTimer, widgetTimer;
  const icons = root => root.querySelectorAll('[data-icon]').forEach(node => {
    if (!window.lucide?.icons[node.dataset.icon]) return;
    const element = lucide.createElement(lucide.icons[node.dataset.icon]);
    element.setAttribute('class', 'icon');element.setAttribute('aria-hidden','true');node.replaceWith(element);
  });
  icons(document);
  const brandImage = document.querySelector('.admin-brand img');
  const fallbackBrand = () => {if (!brandImage.src.endsWith('/assets/planner-icon.svg')) brandImage.src='/assets/planner-icon.svg';};
  brandImage.addEventListener('error',fallbackBrand);
  if (brandImage.complete && !brandImage.naturalWidth) fallbackBrand();
  document.querySelector('#session-error a').href = '/auth/?rd=' + encodeURIComponent(location.origin + '/admin/');
  function appearanceButtons() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const large = document.documentElement.dataset.font === 'large';
    $('theme').setAttribute('aria-label',dark ? '切换浅色主题' : '切换深色主题');
    $('theme').innerHTML = `<i data-icon="${dark ? 'Sun' : 'Moon'}"></i>`;icons($('theme'));
    $('font').setAttribute('aria-label',large ? '使用标准字号' : '使用大字号');
    $('font').setAttribute('aria-pressed',String(large));
    document.querySelector('meta[name="theme-color"]').content = dark ? '#081a21' : '#f2f4f1';
  }
  appearanceButtons();
  $('theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    SmtvvCommon.setAppearance({theme:next});
    appearanceButtons();
  };
  $('font').onclick = () => {
    const next = document.documentElement.dataset.font === 'large' ? 'standard' : 'large';
    document.documentElement.dataset.font = next;
    SmtvvCommon.setAppearance({font:next});
    appearanceButtons();
  };
  window.addEventListener('storage',event => {
    try {
      if (event.key === null || event.key === 'smtvv-appearance') {
        const saved = JSON.parse(localStorage.getItem('smtvv-appearance') || '{}');
        document.documentElement.dataset.theme = saved?.theme === 'dark' ? 'dark' : 'light';
      }
      if (event.key === null || event.key === 'smtvv-font') document.documentElement.dataset.font = JSON.parse(localStorage.getItem('smtvv-font') || 'null') === 'large' ? 'large' : 'standard';
    } catch {}
    appearanceButtons();
  });
  const duration = seconds => seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
  function feedback(message, error = false) {
    clearTimeout(feedbackTimer);$('feedback-text').textContent = message;
    $('feedback').className = error ? 'error' : '';$('feedback').hidden = !message;
    if (message && !error) feedbackTimer = setTimeout(() => {$('feedback').hidden = true;},8000);
  }
  $('dismiss-feedback').onclick = () => feedback('');
  function controls() {
    $('require-login').disabled = $('maintenance').disabled = !state || busy || expired;
    $('notice-form').querySelector('fieldset').disabled = !state || busy || expired;
    $('password-form').querySelector('fieldset').disabled = !state?.account.canChangePassword || busy || expired;
    $('login-policy-form').querySelector('fieldset').disabled = !state?.loginPolicy || busy || expired;
    $('turnstile-form').querySelector('fieldset').disabled = !state?.turnstile || busy || expired;
    $('discard-login-policy').disabled = !policyDirty || busy || expired;
    $('remember-days').disabled = !$('remember-enabled').checked;
    $('remember-default').disabled = !$('remember-enabled').checked;
    $('turnstile-secret-key').disabled = $('turnstile-clear-secret').checked;
    $('turnstile-clear-secret').disabled = !turnstileSecretConfigured || busy || expired;
    $('save-turnstile').disabled = !turnstileDirty || busy || expired;
    $('discard-turnstile').disabled = !turnstileDirty || busy || expired;
    $('refresh').disabled = busy || refreshing;
    $('discard-notice').disabled = !noticeDirty || busy || expired;
    document.querySelectorAll('[data-cancel]').forEach(button => {button.disabled = busy || expired;});
  }
  async function request(path, data) {
    const controller = new AbortController();
    if (data === undefined) pendingReads.add(controller);
    try {
      return await SmtvvCommon.requestJson('/api/admin/'+path,{data,signal:controller.signal,timeout:30000,cache:'no-store',label:'管理服务',onResponse:response=>{
        if (response.status===401||response.status===403) {
          expired=true;controls();$('session-error').hidden=false;
          $('session-message').textContent=response.status===401?'登录已过期。在新标签页登录后，返回此页继续；未保存的设置和公告会保留。':'当前账户没有管理员权限。请使用管理员账号重新登录。';
        }
      }});
    } catch (error) {
      if (controller.signal.reason==='navigation') throw Object.assign(Error('页面已离开。'),{cancelled:true});
      throw error;
    } finally {pendingReads.delete(controller);}
  }
  function renderSettings(data) {
    state = {...state,...data};const s = state.settings;
    $('require-login').checked = s.requireLogin;$('maintenance').checked = s.maintenance;
    $('access-stamp').textContent = s.requireLogin ? 'PRIVATE / 仅限登录' : 'PUBLIC / 匿名可用';
    $('access-title').textContent = s.requireLogin ? '网站已启用登录保护' : '网站已向所有访客开放';
    $('access-description').textContent = s.requireLogin ? '访客先登录，再查阅资料或生成路线。' : '访客可以直接查阅资料、配置仲魔和生成路线。';
    $('maintenance-label').textContent = s.maintenance ? '已开启 · 暂停新计算' : '未开启';
    $('maintenance-label').classList.toggle('paused', s.maintenance);
    if (!noticeDirty) {
      $('notice-enabled').checked = s.notice.enabled;$('notice-title').value = s.notice.title;$('notice-body').value = s.notice.body;
      $('notice-count').textContent = `${s.notice.body.length} / 1000`;
      noticeBase = JSON.stringify(s.notice);noticeRevision = state.revision;
    } else if (JSON.stringify(s.notice) === noticeBase) {
      noticeRevision = state.revision;
    }
    const conflict = noticeDirty && JSON.stringify(s.notice) !== noticeBase;
    $('notice-state').textContent = conflict ? '公告已在其他页面更新，请先核对' : noticeDirty ? '有未保存的修改' : s.notice.enabled ? '公告正在显示' : '公告未显示';
    $('notice-state').classList.toggle('conflict', conflict);
    renderLoginPolicy(state.loginPolicy);
    renderTurnstile(state.turnstile);
    if (data.history) renderHistory(data.history);
    controls();
  }
  const policyDuration = minutes => minutes % 1440 === 0 ? `${minutes / 1440} 天` : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
  // Hours/days are display units; the API stores exact whole minutes.
  function minutesFrom(value, factor) {
    const raw = Number(value) * factor, rounded = Math.round(raw);
    return String(value).trim() && Number.isFinite(raw) && Math.abs(raw-rounded) < 1e-7 ? rounded : NaN;
  }
  function policyHints() {
    for (const [input, factor, hint] of [['session-hours',60,'session-duration-hint'],['inactivity-minutes',1,'inactivity-duration-hint'],['remember-days',1440,'remember-duration-hint']]) {
      const minutes = minutesFrom($(input).value,factor);
      $(hint).textContent = minutes > 0 && Number.isInteger(minutes) ? `相当于 ${policyDuration(minutes)}` : '请填写可换算为整数分钟的期限';
    }
  }
  function renderLoginPolicy(policy) {
    if (!policy) {$('login-policy-state').textContent = '此部署尚未启用';return;}
    const settings = policy.settings;
    if (!policyDirty) {
      $('session-hours').value = settings.sessionMinutes / 60;
      $('inactivity-minutes').value = settings.inactivityMinutes;
      $('remember-days').value = settings.rememberMinutes / 1440;
      $('remember-enabled').checked = settings.rememberMeEnabled;
      $('remember-default').checked = settings.rememberMeDefault;
      $('remember-password-enabled').checked = settings.rememberPasswordEnabled;
      policyBase = JSON.stringify(settings);policyRevision = policy.revision;
      policyHints();
    } else if (JSON.stringify(settings) === policyBase) policyRevision = policy.revision;
    const conflict = policyDirty && JSON.stringify(settings) !== policyBase;
    $('login-policy-state').textContent = conflict ? '设置已在其他页面更新，请先核对' : policyDirty ? '有未保存的修改' : `普通 ${policyDuration(settings.sessionMinutes)}${settings.rememberMeEnabled ? ' / 记住 ' + policyDuration(settings.rememberMinutes) : ''}`;
    $('login-policy-state').classList.toggle('conflict',conflict);
  }
  const loadTurnstile = SmtvvCommon.loadTurnstile;
  function clearAdminToken(message = '等待验证', retry = false) {
    turnstileAdminToken = '';$('turnstile-preview-state').textContent = message;
    $('retry-turnstile-preview').hidden = !retry;controls();
  }
  function resetAdminWidget(message) {
    renderAdminWidget($('turnstile-site-key').value,true);
    if (message) $('turnstile-preview-state').textContent = message;
  }
  async function renderAdminWidget(siteKey, force = false) {
    clearTimeout(widgetTimer);
    siteKey = String(siteKey || '').trim();
    const theme = document.querySelector('input[name="turnstile-theme"]:checked').value;
    const appearance = document.querySelector('input[name="turnstile-appearance"]:checked').value;
    const key = JSON.stringify([siteKey,theme,appearance]);
    if (!force && key === turnstileAdminSiteKey) return;
    const version = ++widgetGeneration;
    turnstileAdminSiteKey = key;
    clearAdminToken(siteKey ? '正在加载' : '等待验证');
    if (turnstileAdminWidget !== null && window.turnstile) {
      try {window.turnstile.remove(turnstileAdminWidget);} catch {}
    }
    turnstileAdminWidget = null;$('turnstile-admin-widget').replaceChildren();
    $('turnstile-preview').hidden = !siteKey;
    if (!siteKey) return;
    try {
      const api = await loadTurnstile();
      if (version !== widgetGeneration) return;
      turnstileAdminWidget = api.render('#turnstile-admin-widget', {sitekey:siteKey,theme,appearance,size:'flexible',action:'turnstile_settings',
        callback:token => {if (version !== widgetGeneration) return;turnstileAdminToken=token;$('turnstile-preview-state').textContent='已验证';$('retry-turnstile-preview').hidden=true;controls();},
        'expired-callback':() => {if (version === widgetGeneration) clearAdminToken('验证已过期',true);},
        'timeout-callback':() => {if (version === widgetGeneration) clearAdminToken('验证超时',true);},
        'error-callback':() => {if (version === widgetGeneration) clearAdminToken('验证未完成',true);return true;}});
    } catch (error) {
      if (version === widgetGeneration) {clearAdminToken('加载失败',true);feedback(error.message,true);}
    }
  }
  $('retry-turnstile-preview').onclick = () => resetAdminWidget();
  function renderTurnstile(policy) {
    if (!policy) {$('turnstile-config-state').textContent='此部署尚未启用';return;}
    const settings = policy.settings;
    if (!turnstileDirty) {
      $('turnstile-enabled').checked = settings.enabled;
      $('turnstile-site-key').value = settings.siteKey;
      $('turnstile-secret-key').value = '';$('turnstile-clear-secret').checked = false;
      document.querySelector(`input[name="turnstile-theme"][value="${settings.theme}"]`).checked = true;
      document.querySelector(`input[name="turnstile-appearance"][value="${settings.appearance}"]`).checked = true;
      turnstileBase = JSON.stringify(settings);turnstileRevision = policy.revision;turnstileSecretConfigured = !!policy.secretConfigured;
      renderAdminWidget(settings.siteKey);controls();
    }
    // A secret rotation changes the revision even when public settings match.
    const conflict = turnstileDirty && policy.revision !== turnstileRevision;
    $('turnstile-config-state').textContent = conflict ? '设置已在其他页面更新' : settings.enabled ? '已启用' : turnstileSecretConfigured ? '已配置，未启用' : '未配置';
    $('turnstile-config-state').className = 'config-stamp ' + (conflict ? 'conflict' : settings.enabled ? 'online' : '');
    $('turnstile-secret-state').textContent = turnstileSecretConfigured ? '已配置，不会显示' : '尚未配置';
  }
  function renderJobs(jobs) {
    const c = jobs.counts;
    $('job-count').textContent = `${jobs.items.length} 个保留任务`;
    $('queue-summary').innerHTML = `正在计算 <strong>${c.running}</strong> · 排队 <strong>${c.queued}</strong> · 已完成 ${c.completed} · 已取消 ${c.cancelled} · 未完成 ${c.failed} <span> / 队列容量 ${jobs.capacity}</span>`;
    if (jobs.mode === 'remote') $('queue-summary').innerHTML += `<br><span>远程计算 · ${(jobs.workers || []).map(node => `${esc(node.name)}：${node.onlineSlots}/${node.slots} 在线，${node.running} 个计算中`).join(' · ')} · 主站不执行计算</span>`;
    // Preserve a keyboard user's cancel button while its job still exists.
    const focused = document.activeElement?.dataset.cancel;
    $('job-list').innerHTML = jobs.items.length ? jobs.items.map(job => `<tr><td><strong>${esc(job.label)}</strong><small title="${esc(job.id)}">${esc(job.id)}</small></td><td><span class="job-state ${esc(job.status)}">${esc(statusNames[job.status] || job.status)}</span></td><td>${esc(job.stage)}</td><td class="elapsed">${duration(job.seconds)}</td><td>${job.canCancel ? `<button class="quiet" data-cancel="${esc(job.id)}" aria-label="取消${esc(job.label)}的计算">取消</button>` : '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">暂无计算任务。访客生成路线后，会在这里显示。</td></tr>';
    if (focused) [...$('job-list').querySelectorAll('[data-cancel]')].find(button => button.dataset.cancel === focused)?.focus({preventScroll:true});
  }
  function eventText(event) {
    if (event.action === 'cancel') return '取消计算任务 ' + (event.detail?.jobId || '');
    if (event.action === 'password') return event.detail?.sessionsRevoked ? '修改登录密码，旧会话已清除' : '修改登录密码';
    if (event.action === 'password-request') return '发起密码修改验证';
    if (event.action === 'login-policy') return Object.entries(event.detail || {}).map(([key,value]) => ({sessionMinutes:'普通登录有效期',inactivityMinutes:'闲置超时',rememberMinutes:'记住登录有效期'}[key] ? `${{sessionMinutes:'普通登录有效期',inactivityMinutes:'闲置超时',rememberMinutes:'记住登录有效期'}[key]}改为 ${policyDuration(value)}` : `${{rememberMeEnabled:'保持登录选项',rememberMeDefault:'默认保持登录',rememberPasswordEnabled:'记住密码选项'}[key] || key}${value ? '已开启' : '已关闭'}`)).join('；');
    if (event.action === 'turnstile') return Object.entries(event.detail || {}).map(([key,value]) => key === 'enabled' ? (value ? '启用登录人机验证' : '关闭登录人机验证') : key === 'siteKey' ? '更新 Turnstile Site Key' : key === 'secretChanged' ? (value ? '更新 Turnstile Secret Key' : '清除 Turnstile Secret Key') : key === 'theme' ? `验证码主题改为 ${{auto:'跟随系统',light:'浅色',dark:'深色'}[value] || value}` : key === 'appearance' ? `验证码显示方式改为 ${{'interaction-only':'需要时显示',always:'始终显示'}[value] || value}` : key).join('；');
    if (event.action === 'settings') return Object.entries(event.detail || {}).map(([key,value]) => key === 'requireLogin' ? (value ? '开启网站登录保护' : '开放匿名访问') : key === 'maintenance' ? (value ? '开启维护模式' : '关闭维护模式') : key === 'notice' ? (value.enabled ? '发布或更新公告' : '关闭公告') : key).join('；');
    return event.action;
  }
  function renderHistory(history) {
    history = [...history.filter(event => !['login-policy','turnstile'].includes(event.action)),...(state?.loginPolicy?.history || []),...(state?.turnstile?.history || [])].sort((a,b) => b.at.localeCompare(a.at));
    $('audit-list').innerHTML = history.length ? history.slice(0,30).map(event => `<li><time datetime="${esc(event.at)}">${esc(new Date(event.at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}))}</time><span>${esc(eventText(event))}</span><span class="audit-actor">${esc(event.actor)}</span></li>`).join('') : '<li class="empty-state">还没有管理操作记录。</li>';
  }
  async function refresh(manual = false) {
    if (busy || refreshing || leaving) return;
    refreshing = true;controls();const before = generation;
    try {
      const result = await request('overview');if (before !== generation) return;
      const recovered = expired, initial = !state;
      expired = false;$('session-error').hidden = true;
      renderSettings(result);renderJobs(result.jobs);$('username').textContent = result.account.username;
      $('password-username').value = result.account.username;$('version').textContent = result.version;
      $('uptime').textContent = duration(result.uptime);$('catalog').textContent = `${result.catalog.demons} 仲魔 / ${result.catalog.skills} 技能`;
      $('health').textContent = '运行正常';$('health').className = 'online';
      $('last-sync').textContent = '最近同步 ' + new Date().toLocaleTimeString('zh-CN',{hour12:false});
      if (!result.account.canChangePassword) {$('password-feedback').hidden = false;$('password-feedback').textContent = '此部署尚未启用后台密码修改。';}
      if (manual) feedback('站点状态已更新。');
      else if (recovered) feedback('登录已恢复，可以继续编辑。');
      else if (initial) feedback('');
    } catch (error) {if (!leaving && !error.cancelled) {$('health').textContent = '连接异常';$('health').className = '';feedback(error.message,true);}}
    finally {refreshing = false;controls();}
  }
  async function save(patch, message) {
    if (busy || !state) return;
    busy = true;generation++;controls();
    try {
      const result = await request('settings',{revision:patch.notice ? noticeRevision : state.revision,patch});
      if (patch.notice) noticeDirty = false;
      renderSettings(result);feedback(message);
    } catch (error) {renderSettings(state);feedback(error.message,true);if (error.status === 409) setTimeout(() => refresh(),0);}
    finally {busy = false;controls();}
  }
  $('require-login').onchange = () => save({requireLogin:$('require-login').checked},$('require-login').checked ? '登录保护已开启，新请求需要登录。' : '网站已开放，访客可以匿名使用。');
  $('maintenance').onchange = () => save({maintenance:$('maintenance').checked},$('maintenance').checked ? '维护模式已开启，暂停创建新计算。' : '维护模式已关闭，可以创建新计算。');
  $('notice-form').addEventListener('input',() => {noticeDirty = true;$('notice-state').textContent = '有未保存的修改';$('notice-count').textContent = `${$('notice-body').value.length} / 1000`;controls();});
  $('discard-notice').onclick = () => {noticeDirty = false;renderSettings(state);feedback('已载入当前发布的公告。');};
  $('notice-form').onsubmit = event => {event.preventDefault();save({notice:{enabled:$('notice-enabled').checked,title:$('notice-title').value,body:$('notice-body').value}},'公告设置已保存。');};
  $('login-policy-form').addEventListener('input', () => {policyDirty = true;$('login-policy-state').textContent = '有未保存的修改';policyHints();controls();});
  $('discard-login-policy').onclick = () => {policyDirty = false;renderLoginPolicy(state.loginPolicy);controls();feedback('已载入当前保存的登录设置。');};
  $('login-policy-form').onsubmit = async event => {
    event.preventDefault();if (busy || !state?.loginPolicy) return;
    const patch = {sessionMinutes:minutesFrom($('session-hours').value,60),inactivityMinutes:minutesFrom($('inactivity-minutes').value,1),
      rememberMinutes:minutesFrom($('remember-days').value,1440),rememberMeEnabled:$('remember-enabled').checked,
      rememberMeDefault:$('remember-default').checked,rememberPasswordEnabled:$('remember-password-enabled').checked};
    if (![patch.sessionMinutes,patch.inactivityMinutes,patch.rememberMinutes].every(Number.isInteger)) {feedback('期限需换算为整数分钟，请核对输入。',true);return;}
    if (patch.inactivityMinutes > patch.sessionMinutes) {feedback('闲置超时不能长于普通登录有效期。',true);return;}
    if (patch.rememberMeEnabled && patch.rememberMinutes < patch.sessionMinutes) {feedback('记住登录的有效期不能短于普通登录有效期。',true);return;}
    busy = true;generation++;controls();feedback('正在保存登录设置…');
    try {
      const result = await request('login-policy',{revision:policyRevision,patch});
      state.loginPolicy = result;policyDirty = false;renderLoginPolicy(result);renderHistory(state.history || []);
      if (result.sessionChanged && result.sessionsRevoked) {
        expired = true;$('session-error').hidden = false;$('session-message').textContent = '新的登录期限已生效，旧会话已清除。请在新标签页重新登录。';
        feedback('登录设置已保存并生效，请重新登录。');
      } else if (result.sessionChanged) feedback('登录设置已保存，尚未确认认证服务重载，请稍后刷新检查。',true);
      else feedback('登录设置已保存，刷新登录页即可看到变化。');
    } catch (error) {feedback(error.message,true);if (error.status === 409) setTimeout(() => refresh(),0);}
    finally {busy = false;controls();}
  };
  $('turnstile-form').addEventListener('input', event => {
    turnstileDirty = true;$('turnstile-config-state').textContent = '有未保存的修改';$('turnstile-config-state').className = 'config-stamp';
    if (['turnstile-site-key','turnstile-secret-key'].includes(event.target.id)) {
      // Reject callbacks from the old key immediately; wait for typing to settle.
      ++widgetGeneration;turnstileAdminSiteKey = '';clearAdminToken('等待验证');
      clearTimeout(widgetTimer);widgetTimer = setTimeout(() => renderAdminWidget($('turnstile-site-key').value),350);
    } else if ((event.target.name || '').startsWith('turnstile-') || event.target.id === 'turnstile-clear-secret') resetAdminWidget();
    controls();
  });
  $('turnstile-clear-secret').onchange = () => {turnstileDirty = true;if ($('turnstile-clear-secret').checked) $('turnstile-enabled').checked = false;controls();};
  $('discard-turnstile').onclick = () => {turnstileDirty = false;renderTurnstile(state.turnstile);controls();feedback('已载入当前保存的 Turnstile 设置。');};
  $('turnstile-form').onsubmit = async event => {
    event.preventDefault();if (busy || !state?.turnstile) return;
    const patch = {enabled:$('turnstile-enabled').checked,siteKey:$('turnstile-site-key').value.trim(),
      theme:document.querySelector('input[name="turnstile-theme"]:checked').value,
      appearance:document.querySelector('input[name="turnstile-appearance"]:checked').value};
    const secretKey = $('turnstile-secret-key').value.trim(), clearSecret = $('turnstile-clear-secret').checked;
    const needsVerification = patch.enabled && (!JSON.parse(turnstileBase || '{}').enabled || patch.siteKey !== JSON.parse(turnstileBase || '{}').siteKey || !!secretKey || clearSecret);
    if (needsVerification && !turnstileAdminToken) {feedback('请先完成配置验证，再保存启用设置。',true);return;}
    busy = true;generation++;controls();feedback('正在保存 Turnstile 设置…');
    try {
      const body = {revision:turnstileRevision,patch,verificationToken:turnstileAdminToken};
      if (secretKey) body.secretKey = secretKey;if (clearSecret) body.clearSecret = true;
      const result = await request('turnstile',body);
      state.turnstile = result;turnstileDirty = false;turnstileAdminToken = '';turnstileAdminSiteKey = '';
      renderTurnstile(result);renderHistory(state.history || []);feedback(result.settings.enabled ? 'Turnstile 已启用，新的登录需要完成人机验证。' : 'Turnstile 设置已保存。');
    } catch (error) {resetAdminWidget('请重新验证');feedback(error.message,true);if (error.status === 409) setTimeout(() => refresh(),0);}
    finally {$('turnstile-secret-key').value = '';busy = false;controls();}
  };
  $('job-list').onclick = async event => {
    const button = event.target.closest('[data-cancel]');if (!button || busy) return;
    busy = true;generation++;button.disabled = true;controls();
    try {const result = await request('jobs/cancel',{jobId:button.dataset.cancel});feedback(result.cancelled ? '已发出任务取消指令。' : result.message);}
    catch (error) {feedback(error.message,true);}
    finally {busy = false;controls();await refresh();}
  };
  $('show-password').onclick = () => {const show = $('current-password').type === 'password';for (const id of ['current-password','new-password','confirm-password']) $(id).type = show ? 'text' : 'password';$('show-password').textContent = show ? '隐藏密码' : '显示密码';$('show-password').setAttribute('aria-pressed',String(show));};
  $('password-form').onsubmit = async event => {
    event.preventDefault();if (busy || !state) return;
    $('password-feedback').hidden = false;
    if ($('new-password').value !== $('confirm-password').value) {$('password-feedback').textContent = '两次输入的新密码不一致。';$('confirm-password').focus();return;}
    busy = true;generation++;controls();$('password-feedback').textContent = '正在保存密码并清除旧登录会话…';
    try {
      const result = await request('password',{currentPassword:$('current-password').value,newPassword:$('new-password').value});
      $('password-form').reset();expired = true;
      $('password-feedback').textContent = result.sessionsRevoked ? '密码已更新，旧会话已清除。请使用新密码重新登录。' : '密码已更新，但尚未确认旧会话已清除。请重新登录并检查认证服务状态。';
      $('session-message').textContent = '密码已更新，请使用新密码重新登录。';$('session-error').hidden = false;
      $('session-error').scrollIntoView({block:'center'});
    } catch (error) {$('password-feedback').textContent = error.message;}
    finally {busy = false;controls();}
  };
  $('refresh').onclick = () => refresh(true);
  window.addEventListener('beforeunload',event => {if (noticeDirty || policyDirty || turnstileDirty) {event.preventDefault();event.returnValue = '';}});
  document.addEventListener('visibilitychange',() => {if (!document.hidden) refresh();});
  window.addEventListener('focus',() => refresh());
  window.addEventListener('pagehide',() => {leaving = true;for (const controller of pendingReads) controller.abort('navigation');});
  window.addEventListener('pageshow',() => {leaving = false;refresh();});
  let navigationFrame;
  function updateNavigation() {
    navigationFrame = undefined;
    const sections = [...document.querySelectorAll('.admin-section')];
    const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) + 24;
    const atBottom = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2;
    const current = atBottom ? sections.at(-1) : sections.filter(section => section.getBoundingClientRect().top <= offset).at(-1) || sections[0];
    document.querySelectorAll('.admin-side nav a').forEach(link => {
      if (link.hash === '#' + current.id) {
        if (!link.hasAttribute('aria-current')) {
          link.setAttribute('aria-current','location');
          const nav = link.parentElement, item = link.getBoundingClientRect(), box = nav.getBoundingClientRect();
          if (nav.scrollWidth > nav.clientWidth) {
            if (item.left < box.left) nav.scrollLeft -= box.left-item.left;
            else if (item.right > box.right) nav.scrollLeft += item.right-box.right;
          }
        }
      } else link.removeAttribute('aria-current');
    });
  }
  const scheduleNavigation = () => {if (!navigationFrame) navigationFrame = requestAnimationFrame(updateNavigation);};
  window.addEventListener('scroll',scheduleNavigation,{passive:true});
  window.addEventListener('resize',scheduleNavigation);
  updateNavigation();
  refresh();setInterval(() => {if (!document.hidden && !expired) refresh();},5000);
})();
