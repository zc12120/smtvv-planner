'use strict';
(()=>{
 const buttons=document.querySelectorAll('.back-to-top');
 if(!buttons.length)return;
 const mobile=window.matchMedia('(max-width:699px)');
 const update=()=>{
  const planner=document.body.dataset.page==='planner';
  for(const button of buttons){
   button.hidden=window.scrollY<320||(mobile.matches&&(planner||button.classList.contains('back-to-top--left')));
  }
 };
 window.addEventListener('scroll',update,{passive:true});
 window.addEventListener('pageshow',update);
 mobile.addEventListener('change',update);
 new MutationObserver(update).observe(document.body,{attributes:true,attributeFilter:['data-page']});
 for(const button of buttons)button.addEventListener('click',()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
 update();
})();
