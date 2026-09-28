'use strict';
(()=>{
 const buttons=document.querySelectorAll('.back-to-top');
 if(!buttons.length)return;
 const update=()=>{for(const button of buttons)button.hidden=window.scrollY<320;};
 window.addEventListener('scroll',update,{passive:true});
 window.addEventListener('pageshow',update);
 for(const button of buttons)button.addEventListener('click',()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
 update();
})();
