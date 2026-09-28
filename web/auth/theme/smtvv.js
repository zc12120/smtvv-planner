'use strict';
// Restore appearance before the first paint. Authentication remains in login.js.
(() => {
  const root = document.documentElement;
  const restore = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('smtvv-appearance') || '{}');
      root.dataset.theme = (saved?.theme || localStorage.getItem('smtvv-theme')) === 'dark' ? 'dark' : 'light';
      root.dataset.font = JSON.parse(localStorage.getItem('smtvv-font') || 'null') === 'large' ? 'large' : 'standard';
    } catch {}
  };
  restore();
  document.addEventListener('DOMContentLoaded', () => {
    const theme = document.getElementById('login-theme'), font = document.getElementById('login-font');
    const update = () => {
      theme.setAttribute('aria-label',root.dataset.theme === 'dark' ? '切换浅色主题' : '切换深色主题');
      font.setAttribute('aria-pressed',String(root.dataset.font === 'large'));
      document.querySelector('meta[name="theme-color"]').content = root.dataset.theme === 'dark' ? '#081a21' : '#f2f4f1';
      window.SmtvvI18n?.render(theme);
    };
    theme.onclick = () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        const saved = JSON.parse(localStorage.getItem('smtvv-appearance') || '{}');
        localStorage.setItem('smtvv-appearance',JSON.stringify({skin:['smtv','p5','p3r'].includes(saved?.skin) ? saved.skin : 'smtv',theme:root.dataset.theme}));
        localStorage.setItem('smtvv-theme',root.dataset.theme);
      } catch {}
      update();window.dispatchEvent(new Event('smtvv:login-theme'));
    };
    font.onclick = () => {
      root.dataset.font = root.dataset.font === 'large' ? 'standard' : 'large';
      try {localStorage.setItem('smtvv-font',JSON.stringify(root.dataset.font));} catch {}
      update();
    };
    window.addEventListener('storage',event => {
      if (event.key !== null && !['smtvv-appearance','smtvv-font'].includes(event.key)) return;
      const previous = root.dataset.theme;restore();update();
      if (previous !== root.dataset.theme) window.dispatchEvent(new Event('smtvv:login-theme'));
    });
    const logo = document.querySelector('.login-brand img');
    const fallback = () => {logo.hidden=true;logo.nextElementSibling.hidden=false;};
    logo.addEventListener('error',fallback);if (logo.complete && !logo.naturalWidth) fallback();
    update();
  });
})();
