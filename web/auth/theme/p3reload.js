'use strict';
(() => {
  if (document.getElementById('p3r-auth-scene')) return;
  document.body.classList.add('p3r-auth');
  const scene = document.createElement('div');
  scene.id = 'p3r-auth-scene';
  scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = '<div class="p3r-auth-orbit"></div><div class="p3r-auth-slash"></div>' +
    '<div class="p3r-auth-number">03</div><img class="p3r-auth-protagonist" src="/assets/p3reload/protagonist-battle.webp" alt="" width="609" height="919">' +
    '<div class="p3r-auth-caption"><span>PERSONA 3 RELOAD</span><strong>THE DARK HOUR</strong><small>S.E.E.S. / PROTAGONIST</small></div>';
  document.body.prepend(scene);
  scene.querySelector('img').addEventListener('error', event => { event.currentTarget.hidden = true; });
  const brand = document.createElement('a');
  brand.className = 'p3r-auth-brand';
  brand.href = '/';
  brand.innerHTML = '<span class="p3r-auth-monogram">P3<span>R</span></span><span>真女5复仇<small>FUSION PLANNER</small></span>';
  brand.setAttribute('aria-label', '真女5复仇合体规划');
  document.body.append(brand);
  const credit = document.createElement('a');
  credit.className = 'p3r-auth-credit';
  credit.href = 'https://p3re.jp/';
  credit.target = '_blank';
  credit.rel = 'noopener noreferrer';
  credit.textContent = 'P3 RELOAD VISUAL THEME · ART © ATLUS / SEGA';
  document.body.append(credit);
})();
