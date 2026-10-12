// Local reconstruction of the observed Inframark header dropdown menus (Kadence theme).
// Original theme scripts are excluded; this only discloses captured submenu links.
(()=>{'use strict';
 const items=[...document.querySelectorAll('li.menu-item--has-toggle')].filter(li=>li.querySelector(':scope>ul.sub-menu'));
 const show=(li,open)=>{const sub=li.querySelector(':scope>ul.sub-menu'),button=li.querySelector(':scope>button.dropdown-nav-special-toggle');li.classList.toggle('menu-item--toggled-on',open);
  Object.assign(sub.style,open?{display:'block',opacity:'1',visibility:'visible',clip:'auto',height:'auto',overflow:'visible',transform:'none',pointerEvents:'auto'}:{display:'',opacity:'',visibility:'',clip:'',height:'',overflow:'',transform:'',pointerEvents:''});
  if(button)button.setAttribute('aria-expanded',String(open));
  if(!open)for(const child of li.querySelectorAll('li.menu-item--toggled-on'))show(child,false);};
 for(const [i,li] of items.entries()){
  const sub=li.querySelector(':scope>ul.sub-menu'),parent=li.querySelector(':scope>a'),button=li.querySelector(':scope>button.dropdown-nav-special-toggle');
  sub.id||=('inframark-submenu-'+i);
  const toggle=e=>{e.preventDefault();e.stopPropagation();const open=!li.classList.contains('menu-item--toggled-on');
   for(const other of li.parentElement.querySelectorAll(':scope>li.menu-item--toggled-on'))if(other!==li)show(other,false);show(li,open);};
  if(button){button.disabled=false;button.type='button';button.setAttribute('aria-controls',sub.id);button.addEventListener('click',toggle);}
  if(parent&&!parent.getAttribute('href')){parent.removeAttribute('aria-disabled');parent.removeAttribute('title');parent.setAttribute('role','button');parent.tabIndex=0;parent.setAttribute('aria-expanded','false');parent.setAttribute('aria-controls',sub.id);
   parent.addEventListener('click',e=>{toggle(e);parent.setAttribute('aria-expanded',String(li.classList.contains('menu-item--toggled-on')));});
   parent.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')parent.click();});}
  li.addEventListener('mouseenter',()=>{if(matchMedia('(hover:hover)').matches)show(li,true);});
  li.addEventListener('mouseleave',()=>{if(matchMedia('(hover:hover)').matches)show(li,false);});
 }
 document.addEventListener('click',e=>{if(!e.target.closest('li.menu-item--has-toggle'))for(const li of document.querySelectorAll('li.menu-item--toggled-on'))show(li,false);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const li of document.querySelectorAll('li.menu-item--toggled-on'))show(li,false);});
})();
