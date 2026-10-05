// Bind the captured activation entry; subsequent account setup is synthetic.
async function api(path,input){const response=await fetch(path,input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
const activation=document.querySelector('.Activation');
function alert(message){let p=activation.querySelector('.bw-activation-error');if(!p){p=document.createElement('p');p.className='bw-activation-error';p.setAttribute('role','alert');activation.append(p);}p.textContent=message;}
document.querySelector('.closeButton')?.addEventListener('click',()=>location.href='/MyChart/Authentication/Login');
document.querySelector('.closeButton')?.removeAttribute('disabled');
async function setup(){
 const details=await api('/api/mychart/activation/setup');
 document.querySelector('.pageTitle').textContent='Create your MyWVUChart account';
 activation.innerHTML='<form id="activation-setup" class="bw-activation-setup"><label>MyWVUChart username<input name="username" required autocomplete="username"></label><label>Password<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label><label>Confirm password<input name="confirmPassword" type="password" required autocomplete="new-password"></label><p>Use a password between 10 and 128 characters.</p><button class="_Command primary neutral" type="submit">Create account</button></form>';
 activation.querySelector('[name=username]').value=details.username;
 activation.querySelector('form').onsubmit=async event=>{event.preventDefault();try{await api('/api/mychart/activation/complete',Object.fromEntries(new FormData(event.target)));location.href='/MyChart/Authentication/Login';}catch(error){alert(error.message);}};
}
function codeEntry(){
 const captured=activation.querySelector('.captured-form'),form=document.createElement('form');
 form.id='activation-code';form.className=captured.className;while(captured.firstChild)form.append(captured.firstChild);captured.replaceWith(form);
 const inputs=[form.querySelector('#EID-5'),form.querySelector('#EID-6')],button=form.querySelector('button');
 inputs.forEach((input,index)=>{input.name='part'+(index+1);input.disabled=false;input.required=true;input.maxLength=5;input.autocomplete='off';});
 const update=()=>{button.disabled=!inputs.every(input=>/^[A-Z0-9]{5}$/i.test(input.value));button.setAttribute('aria-disabled',String(button.disabled));};
 inputs.forEach(input=>input.addEventListener('input',update));button.type='submit';update();
 form.onsubmit=async event=>{event.preventDefault();try{await api('/api/mychart/activation/verify',Object.fromEntries(new FormData(form)));location.href='/MyChart/app/activation/setup';}catch(error){alert(error.message);}};
}
if(location.pathname.endsWith('/setup'))setup().catch(error=>alert(error.message));else codeEntry();
