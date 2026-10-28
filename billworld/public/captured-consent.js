// A captured cookie-consent banner closes as it does on the source site: Reject or Accept removes
// every copy of it and changes nothing else (the simulation keeps no cookie preference).
const close=()=>{for(const banner of document.querySelectorAll('.cookie-consent-banner__container'))(banner.parentElement??banner).remove();for(const name of [...document.body.classList])if(/cookie/i.test(name))document.body.classList.remove(name);};
for(const button of document.querySelectorAll('.cookie-consent-banner__btn')){button.disabled=false;button.addEventListener('click',close);}
