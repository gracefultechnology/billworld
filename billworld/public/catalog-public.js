// Local public document controls only. No original source scripts or domain operations.
(()=>{'use strict';for(const button of document.querySelectorAll('button[data-toggle="collapse"][data-target]')){
 const selector=button.dataset.target;if(!/^#[a-zA-Z][\w-]*$/.test(selector))continue;
 const panel=document.getElementById(selector.slice(1));if(!panel?.classList.contains('collapse'))continue;
 button.disabled=false;button.type='button';button.setAttribute('aria-controls',panel.id);
 button.onclick=()=>{const expanded=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(expanded));button.classList.toggle('collapsed',!expanded);panel.classList.toggle('show',expanded);};
}})();
