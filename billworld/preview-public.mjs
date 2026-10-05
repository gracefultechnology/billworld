// Inspect a generated public reconstruction with the existing benchmark server.
import {start}from './server.mjs';import{existsSync}from'node:fs';
const capture=process.argv[2];
if(!/^(?:gvp-home|biller_[a-f0-9]{20}-[a-zA-Z0-9_-]+)$/.test(capture||'')||!existsSync(new URL('./public/reference-pages/'+capture+'/manifest.json',import.meta.url)))throw Error('Choose a built public capture');
const server=await start({port:Number(process.env.BILLWORLD_PUBLIC_PREVIEW_PORT||3112),adminPort:0,dbPath:':memory:'});
console.log('Public reconstruction only; no runnable site coverage or authenticated billing flow.');
console.log(server.baseUrl+'/reference-pages/'+capture+'/index.html');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
