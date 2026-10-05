// Explicit local preview using the same server and services as the benchmark.
import {start} from './server.mjs';
import {constructionSites,constructionTasks} from './registry.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const siteId=process.argv[2];
if(!/^[a-z0-9-]+$/.test(siteId||'')||!constructionSites.has(siteId))throw Error('Choose a registered construction site');
const directory=new URL('./data/',import.meta.url).pathname;mkdirSync(directory,{recursive:true});
const server=await start({port:Number(process.env.BILLWORLD_PREVIEW_PORT||3110),adminPort:0,dbPath:directory+'construction-'+siteId+'.sqlite',construction:true});
for(const task of constructionTasks.values())if(task.site_id===siteId){
 const f=server.world.create({siteId,taskId:task.id}),runner={...f,startUrl:`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,adminUrl:server.adminUrl,adminToken:server.adminToken};
 writeFileSync(directory+task.id+'-construction-runner.json',JSON.stringify(runner,null,2),{mode:0o600});console.log(task.id+': '+runner.startUrl);
}
console.log('Construction preview; these tasks are excluded from released benchmark coverage and scores.');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await server.close();process.exit(0);});
