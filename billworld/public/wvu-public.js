// Local interactions over captured public markup. No production scripts or APIs.
for(const group of document.querySelectorAll('.wvum-adv-accordion-2')){
  const items=[...group.querySelectorAll('.wvum-adv-accordion-item')];
  function set(item,open){
    item.classList.toggle('wvum-adv-accordion-item-open',open);
    item.dataset.open=String(open);
    const title=item.querySelector('.wvum-adv-accordion-header-title'),content=item.querySelector('.wvum-adv-accordion-content');
    title.setAttribute('aria-expanded',String(open));
    content.setAttribute('aria-hidden',String(!open));
    content.style.maxHeight=open?content.firstElementChild.scrollHeight+'px':'0px';
  }
  items.forEach((item,index)=>{
    const title=item.querySelector('.wvum-adv-accordion-header-title'),content=item.querySelector('.wvum-adv-accordion-content');
    content.id||='billing-answer-'+index;
    title.setAttribute('role','button');title.tabIndex=0;title.setAttribute('aria-controls',content.id);
    const toggle=()=>{
      if(item.dataset.disabled==='true')return;
      const open=item.dataset.open!=='true';
      if(group.dataset.allowMultiple!=='true')items.filter(other=>other!==item).forEach(other=>set(other,false));
      set(item,open);
    };
    title.onclick=toggle;title.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();toggle();}};
    set(item,group.dataset.openFirst==='true'&&index===0);
  });
  window.addEventListener('resize',()=>items.filter(item=>item.dataset.open==='true').forEach(item=>set(item,true)));
}
for(const nav of document.querySelectorAll('#main-header .mobile_nav')){
  const bar=nav.querySelector('.mobile_menu_bar'),menu=nav.querySelector('.et_mobile_menu');
  if(!bar||!menu)continue;
  bar.setAttribute('role','button');bar.setAttribute('aria-label','Menu');bar.tabIndex=0;bar.setAttribute('aria-expanded','false');
  const toggle=()=>{const open=nav.classList.contains('closed');nav.classList.toggle('closed',!open);nav.classList.toggle('opened',open);if(!open){menu.classList.remove('mobile-menu-open');menu.querySelectorAll('.submenu-open').forEach(item=>item.classList.remove('submenu-open'));menu.querySelectorAll('.sub-menu.visible').forEach(submenu=>submenu.classList.remove('visible'));}bar.setAttribute('aria-expanded',String(open));};
  bar.onclick=toggle;bar.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();toggle();}};
  for(const item of menu.querySelectorAll(':scope > .menu-item-has-children')){
    const anchor=item.querySelector(':scope > a'),submenu=item.querySelector(':scope > .sub-menu');
    if(!anchor||!submenu)continue;
    anchor.removeAttribute('aria-disabled');anchor.removeAttribute('title');anchor.setAttribute('role','button');anchor.tabIndex=0;anchor.setAttribute('aria-expanded','false');
    const expand=event=>{event.preventDefault();const open=!item.classList.contains('submenu-open');item.classList.toggle('submenu-open',open);submenu.classList.toggle('visible',open);menu.classList.toggle('mobile-menu-open',open);anchor.setAttribute('aria-expanded',String(open));};
    const arrow=item.querySelector(':scope > .mobile-toggle');if(arrow){arrow.removeAttribute('aria-disabled');arrow.setAttribute('role','button');arrow.tabIndex=0;arrow.setAttribute('aria-label',anchor.textContent.trim());arrow.onclick=expand;}
    anchor.onclick=expand;anchor.onkeydown=event=>{if(['Enter',' '].includes(event.key))expand(event);};
    item.querySelector('.mobile-return-toggle')?.addEventListener('click',event=>{event.preventDefault();item.classList.remove('submenu-open');submenu.classList.remove('visible');menu.classList.remove('mobile-menu-open');anchor.setAttribute('aria-expanded','false');});
  }
}
