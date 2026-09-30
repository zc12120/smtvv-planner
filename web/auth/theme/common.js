'use strict';
// Shared transport and preferences. Callers own retry and authentication policy.
(() => {
  const read = (key, fallback = null) => {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}};
  const write = (key, value) => {try {localStorage.setItem(key, JSON.stringify(value));return true;} catch {return false;}};
  const appearance = () => {
    const saved = read('smtvv-appearance', {});
    return {skin:['smtv','p5','p3r'].includes(saved.skin) ? saved.skin : 'smtv',
      theme:saved.theme === 'dark' ? 'dark' : 'light',font:read('smtvv-font') === 'large' ? 'large' : 'standard'};
  };
  function setAppearance(patch, persist = true) {
    const next = {...appearance(), ...patch};
    Object.assign(document.documentElement.dataset, next);
    if (persist) {
      write('smtvv-appearance', {skin:next.skin,theme:next.theme});
      write('smtvv-font', next.font);
      try {localStorage.setItem('smtvv-theme',next.theme);} catch {}
    }
    return next;
  }
  function retryDelay(response, attempt = 0) {
    const value = response?.headers.get('Retry-After');
    const seconds = value == null ? NaN : Number(value);
    const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    return Math.min(30000, Math.max(400 * (attempt + 1), Number.isFinite(requested) ? requested : 0));
  }
  function abortable(promise, signal) {
    return new Promise((resolve,reject) => {
      const cancel = () => reject(new DOMException('请求已取消','AbortError'));
      if (signal.aborted) {cancel();return;}
      signal.addEventListener('abort',cancel,{once:true});
      promise.then(resolve,reject).finally(() => signal.removeEventListener('abort',cancel));
    });
  }
  async function requestJson(url, {data, attempts = 1, timeout = 12000, signal,
    label = '请求', isCurrent = () => true, onRetry = () => {}, onResponse = () => {},
    statusMessage = status => `${label}失败（HTTP ${status}），请重试。`, ...options} = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!isCurrent() || signal?.aborted) throw new DOMException('请求已取消','AbortError');
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort',cancel,{once:true});
      const timer = setTimeout(cancel,timeout);
      try {
        const early = attempt === 0 ? window.smtvvEarlyRequests?.get(url) : null;
        if (early) window.smtvvEarlyRequests.delete(url);
        let response, body;
        if (early) {
          const result = await abortable(early,controller.signal);
          if (result.error) throw result.error;
          ({response,body} = result);
        } else {
          response = await fetch(url,{...options,signal:controller.signal,
            ...(data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json',...options.headers},body:JSON.stringify(data)})});
          try {body = await response.json();} catch (error) {if (controller.signal.aborted) throw error;}
        }
        onResponse(response);
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!response.ok) throw Object.assign(Error(typeof body?.error === 'string' ? body.error : statusMessage(response.status)),
          {status:response.status,retryable,delay:retryDelay(response,attempt)});
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(Error(`${label}返回的数据不完整，请重试。`),{retryable:true});
        return body;
      } catch (error) {
        if (!isCurrent() || signal?.aborted) throw new DOMException('请求已取消','AbortError');
        if (controller.signal.aborted || error.name === 'AbortError') error = Object.assign(Error(`${label}连接超时，请重试。`),{retryable:true});
        else if (error instanceof TypeError) error = Object.assign(Error(`暂时无法连接${label}，请稍后重试。`),{retryable:true});
        if (!error.retryable || attempt + 1 >= attempts) throw error;
        clearTimeout(timer);onRetry(attempt + 1,error);
        await new Promise(resolve => setTimeout(resolve,error.delay || 400 * (attempt + 1)));
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
    }
  }
  let turnstileLoader;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(failed,12000);
      function failed() {clearTimeout(timer);script.onload=script.onerror=null;script.remove();turnstileLoader=null;reject(Error('人机验证资源加载失败，请重试。'));}
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload=()=>{if (!window.turnstile) {failed();return;}clearTimeout(timer);resolve(window.turnstile);};
      script.onerror=failed;document.head.append(script);
    });
    return turnstileLoader;
  }
  function fingerprint(value) {
    const text = JSON.stringify(value);let a=2166136261,b=0x9e3779b9;
    for (let i=0;i<text.length;i++) {a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),2246822519);}
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  window.SmtvvCommon={read,write,appearance,setAppearance,retryDelay,requestJson,loadTurnstile,fingerprint};
})();
