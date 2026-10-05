import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';
import { sites,tasks } from '../registry.mjs';
const siteId='dental-http-fixture',taskId='dental-http-fixture-v1';
const identity={accountNumber:'123001048',zipCode:'56007',dateOfBirth:'04/12/1985'};
const bank={kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048',amountCents:30000};
test('PersonaPay HTTP endpoints enforce origin, cookies, account-level posting and episode isolation',async()=>{
  sites.set(siteId,{id:siteId,name:'Dental HTTP construction fixture',default_task_id:taskId,runtime:{kind:'personapay',mail_sender_slug:'dental'},billing_policy:{fee_cents:0}});
  tasks.set(taskId,{id:taskId,site_id:siteId,evidence_cohort:'synthetic_checkout',budget:{seconds:300},goal:{}});
  const server=await start({port:0,adminPort:0,dbPath:':memory:'});
  async function client(fixture){
    const jar=new Map();
    async function request(path,input,origin=server.baseUrl){
      const res=await fetch(server.baseUrl+path,{method:input===undefined?'GET':'POST',redirect:'manual',headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(input===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(input===undefined?{}:{body:JSON.stringify(input)})});
      const cookies=res.headers.getSetCookie();for(const value of cookies){const [k,v]=value.split(';')[0].split('=');jar.set(k,v);}
      return {status:res.status,cookies,body:res.headers.get('content-type')?.includes('json')?await res.json():await res.text()};
    }
    await request(`/enter/${fixture.episodeId}/${fixture.entryToken}`);return {request,jar};
  }
  try{
    const f=server.world.create({siteId}),c=await client(f);
    assert.equal((await c.request('/api/personapay/statement')).status,401);
    assert.equal((await c.request('/api/personapay/login',identity,'https://outside.example')).status,403);
    assert.equal(server.world.state(f.episodeId).personaPayFailures,0);
    for(let i=0;i<3;i++)assert.equal((await c.request('/api/personapay/login',{...identity,zipCode:'99999'})).status,401);
    assert.deepEqual((await c.request('/api/personapay/status')).body,{captchaRequired:true});
    assert.equal((await c.request('/api/personapay/login',identity)).status,403);
    const login=await c.request('/api/personapay/login',{...identity,captcha:true});assert.equal(login.status,200);assert.equal('session' in login.body,false);assert.ok(login.cookies.some(x=>x.startsWith('bw_session=')&&x.includes('HttpOnly')));
    const quote=await c.request('/api/personapay/quote',bank);assert.equal(quote.status,200);assert.equal('token' in quote.body,false);assert.equal(quote.body.creditCents,9068);assert.ok(quote.cookies.some(x=>x.startsWith('bw_dental_quote=')&&x.includes('HttpOnly')));
    assert.equal((await c.request('/api/personapay/review')).body.amountCents,30000);
    assert.equal((await c.request('/api/pay',{token:c.jar.get('bw_dental_quote')})).status,404);
    const other=await client(server.world.create({siteId}));await other.request('/api/personapay/login',identity);other.jar.set('bw_dental_quote',c.jar.get('bw_dental_quote'));
    assert.equal((await other.request('/api/personapay/pay',{})).status,403);
    assert.equal((await c.request('/api/personapay/pay',{},'https://outside.example')).status,403);
    const paid=await c.request('/api/personapay/pay',{});assert.equal(paid.status,200);assert.equal(paid.body.creditCents,9068);
    assert.equal((await c.request('/api/personapay/pay',{})).body.confirmation,paid.body.confirmation);
    assert.equal((await c.request('/api/personapay/receipt')).body.confirmation,paid.body.confirmation);
    assert.equal((await c.request('/api/personapay/statement')).body.balanceCents,0);
    assert.equal(server.world.state(f.episodeId).payments.filter(p=>!p.initial).length,1);
    const generic=await client(server.world.create());assert.equal((await generic.request('/api/personapay/status')).status,404);
    const planFixture=server.world.create({siteId}),planClient=await client(planFixture);await planClient.request('/api/personapay/login',identity);
    const planQuote=await planClient.request('/api/personapay/plans/quote',{...bank,type:'recurring',invoiceIds:['inv-current','inv-second'],amountCents:20932,initialCents:0,cycles:2,recurrence:'Monthly',firstDate:'2026-10-10'});
    assert.equal(planQuote.status,200);assert.equal('token' in planQuote.body,false);assert.ok(planQuote.cookies.some(x=>x.startsWith('bw_dental_plan=')&&x.includes('HttpOnly')));
    assert.equal((await planClient.request('/api/personapay/plans/review')).body.installments.length,2);
    assert.equal((await planClient.request('/api/personapay/plans/enroll',{authorize:false})).status,400);
    const plan=await planClient.request('/api/personapay/plans/enroll',{authorize:true});assert.equal(plan.status,200);assert.equal(plan.body.status,'active');
    assert.equal((await planClient.request('/api/personapay/plans/enroll',{authorize:true})).body.id,plan.body.id);
    assert.equal((await planClient.request('/api/personapay/plans/review')).status,401);
    assert.equal((await other.request('/api/personapay/plans/cancel',{planId:plan.body.id})).status,404);
    assert.equal((await planClient.request('/api/personapay/plans/cancel',{planId:plan.body.id},'https://outside.example')).status,403);
    assert.equal((await planClient.request('/api/personapay/plans/cancel',{planId:plan.body.id})).body.status,'cancelled');
    assert.equal((await planClient.request('/api/personapay/plans')).body.plans.length,1);
    await c.request('/api/logout',{});assert.equal((await c.request('/api/personapay/receipt')).status,401);
  }finally{await server.close();sites.delete(siteId);tasks.delete(taskId);}
});
