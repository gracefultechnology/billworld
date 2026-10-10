// Local reconstruction of observed ONSWC document controls. No original scripts.
(()=>{'use strict';
 const activate=(node,action)=>{node.tabIndex=0;node.addEventListener('click',action);node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();action();}});};
 const items=[...document.querySelectorAll('.dsm-faq-item-wrapper')];
 for(const [i,item] of items.entries()){
  const title=item.querySelector('.dsm-faq-title'),body=item.querySelector('.dsm-faq-content');if(!title||!body)continue;
  body.id='onswc-answer-'+i;title.setAttribute('role','button');title.setAttribute('aria-controls',body.id);
  const sync=()=>{const open=item.classList.contains('dsm-faq-item-active');title.setAttribute('aria-expanded',String(open));body.hidden=!open;body.style.display=open?'block':'none';};
  item.onswcSync=sync;sync();
  activate(title,()=>{for(const sibling of items){sibling.classList.toggle('dsm-faq-item-active',sibling===item);sibling.onswcSync?.();}});
 }
 for(const group of document.querySelectorAll('.dsm-advanced-tabs-container')){
  const tabs=[...group.querySelectorAll('.dsm-tab[data-tabid]')],panels=[...group.querySelectorAll('.dsm-content-wrapper[data-contentid]')];
  const select=tab=>{for(const t of tabs){const active=t===tab;t.classList.toggle('dsm-active',active);t.setAttribute('aria-selected',String(active));}for(const p of panels){const active=p.dataset.contentid===tab.dataset.tabid;p.classList.toggle('dsm-active',active);p.hidden=!active;p.style.display=active?'block':'none';}};
  for(const tab of tabs){tab.id=tab.id.trim();const panel=panels.find(p=>p.dataset.contentid===tab.dataset.tabid);if(!panel)continue;panel.id=panel.id.trim();panel.setAttribute('role','tabpanel');activate(tab,()=>select(tab));}
  const initial=tabs.find(t=>t.classList.contains('dsm-active'))||tabs[0];if(initial)select(initial);
 }
})();
