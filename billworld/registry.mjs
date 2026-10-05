import { readdirSync, readFileSync } from 'node:fs';
const readDirectory = name => readdirSync(new URL(`./${name}/`, import.meta.url)).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(new URL(`./${name}/${file}`, import.meta.url))));
export const sites = new Map();
export const constructionSites = new Map();
for (const site of readDirectory('sites').filter(site => ['first_slice','construction_slice'].includes(site.implementation_status))) {
  if (!site.runtime || !site.default_task_id) throw new Error(`Missing explicit runtime configuration: ${site.id}`);
  if (sites.has(site.id)||constructionSites.has(site.id)) throw new Error(`Duplicate site ID: ${site.id}`);
  (site.implementation_status==='first_slice'?sites:constructionSites).set(site.id, site);
}
export const tasks = new Map();
export const constructionTasks = new Map();
for (const task of readDirectory('tasks')) {
  if (!sites.has(task.site_id)&&!constructionSites.has(task.site_id)) continue;
  if (tasks.has(task.id)||constructionTasks.has(task.id)) throw new Error(`Duplicate task ID: ${task.id}`);
  (sites.has(task.site_id)?tasks:constructionTasks).set(task.id, task);
}
for (const site of [...sites.values(),...constructionSites.values()]) if ((tasks.get(site.default_task_id)||constructionTasks.get(site.default_task_id))?.site_id !== site.id) throw new Error(`Invalid default task for ${site.id}`);
