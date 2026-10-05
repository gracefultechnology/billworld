import test from 'node:test';import assert from 'node:assert/strict';import {start} from '../server.mjs';
test('CUSI transport requires the entered episode, same origin and HttpOnly recovery grant',async()=>{
 const s=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});
 try{
  const f=s.world.create({siteId:'lockwood'}),cookie=`bw_episode=${f.episodeId}; bw_access=${f.entryToken}`,headers={Cookie:cookie,Origin:s.baseUrl,'Content-Type':'application/json'};
  const post=(path,data,extra={})=>fetch(s.baseUrl+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
  assert.equal((await post('/api/cusi/login',{username:'alex.morgan',password:'Billworld-2026!'},{Origin:'https://unrelated.test'})).status,403);
  const login=await post('/api/cusi/login',{username:'alex.morgan',password:'Billworld-2026!'});assert.equal(login.status,200);assert.equal((await login.json()).session,undefined);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await post('/api/reset/request',{email:'alex@billworld.test'})).status,404);assert.equal((await post('/api/auth/google',{})).status,404);
  await post('/api/cusi/recovery/request',{username:'alex.morgan'});const token=s.world.state(f.episodeId).mail.at(-1).text.match(/token=([\w-]+)/)[1];
  assert.equal((await post('/api/cusi/recovery/complete',{token,password:'Restored-2026!',confirmPassword:'Restored-2026!'})).status,401);
  const grant=await fetch(s.baseUrl+'/Account/ResetPassword?token='+token,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(grant.status,302);assert.equal(grant.headers.get('location'),'/Account/ResetPassword');const resetCookie=grant.headers.get('set-cookie');assert.match(resetCookie,/HttpOnly/);assert.match(resetCookie,/SameSite=Lax/);
  const grantedCookie=cookie+'; '+resetCookie.split(';')[0];const complete=await post('/api/cusi/recovery/complete',{token:'wrong-body-token',password:'Restored-2026!',confirmPassword:'Restored-2026!'},{Cookie:grantedCookie});assert.equal(complete.status,200);assert.equal((await post('/api/cusi/recovery/complete',{password:'Restored-2026!',confirmPassword:'Restored-2026!'},{Cookie:grantedCookie})).status,401);
  const other=s.world.create({siteId:'juneau-utilities'});assert.equal((await post('/api/cusi/login',{username:'alex.morgan',password:'Billworld-2026!'},{Cookie:`bw_episode=${other.episodeId}; bw_access=${other.entryToken}`})).status,404);
 }finally{await s.close();}
});
test('CUSI card transport keeps review token HttpOnly and ignores body tokens and altered charges',async()=>{
 const s=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});try{
  const f=s.world.create({siteId:'lockwood',taskId:'lockwood-pay-current-card-v1'});let cookies=`bw_episode=${f.episodeId}; bw_access=${f.entryToken}`;
  const post=(path,data,origin=s.baseUrl)=>fetch(s.baseUrl+'/api/cusi/'+path,{method:'POST',headers:{Cookie:cookies,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const login=await post('login',{username:'alex.morgan',password:'Billworld-2026!'});cookies+='; '+login.headers.get('set-cookie').split(';')[0];const data={invoiceId:'inv-current',amountCents:8432,kind:'card',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123',name:'Alex Morgan'};
  assert.equal((await post('quote',data,'https://unrelated.test')).status,403);const q=await post('quote',data),body=await q.json();assert.equal(body.token,undefined);assert.equal(body.totalCents,8682);assert.match(q.headers.get('set-cookie'),/HttpOnly/);const token=s.world.state(f.episodeId).quotes;assert.equal(Object.keys(token).length,1);assert.equal((await post('pay',{token:'body-only',authorize:true})).status,404);cookies+='; '+q.headers.get('set-cookie').split(';')[0];assert.equal((await post('pay',{authorize:false})).status,400);const paid=await post('pay',{token:'ignored',amountCents:1,feeCents:0,authorize:true}),p=await paid.json();assert.equal(p.amountCents,8432);assert.equal(p.feeCents,250);assert.equal((await(await post('pay',{authorize:true})).json()).id,p.id);assert.equal((await fetch(s.baseUrl+'/api/cusi/receipt',{headers:{Cookie:cookies}})).status,200);
 }finally{await s.close();}
});
