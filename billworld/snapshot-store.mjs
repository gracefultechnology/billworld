import {readFileSync, readdirSync, realpathSync} from 'node:fs';
import {resolve, relative, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const capturePattern=/^(?:gvp-home|biller_[a-f0-9]{20}-[a-zA-Z0-9_-]+)$/;
const filePattern=/^(?:[a-f0-9]{64}|index\.html|reconstruction\.css)$/;
const hashPattern=/^[a-f0-9]{64}$/;
function contained(base,path){const name=relative(base,path);return name!==''&&!name.startsWith('..')&&!isAbsolute(name);}

// Index directories at startup; read manifests and verified bodies only on demand.
export class SnapshotStore {
  constructor(directory,{maxBytes=16*1024*1024,maxManifests=64,maxBodies=256,verifyBehavior=()=>{},read=readFileSync}={}){
    if(!Number.isSafeInteger(maxBytes)||maxBytes<0||!Number.isSafeInteger(maxManifests)||maxManifests<1||!Number.isSafeInteger(maxBodies)||maxBodies<1)throw Error('Invalid snapshot cache limits');
    this.directory=realpathSync(directory);this.maxBytes=maxBytes;this.maxManifests=maxManifests;this.maxBodies=maxBodies;this.verifyBehavior=verifyBehavior;this.read=read;
    this.captures=new Set(readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()&&capturePattern.test(e.name)).map(e=>e.name));
    this.manifests=new Map();this.bodies=new Map();this.cachedBytes=0;this.bodyReads=0;
  }
  touch(cache,key,value){cache.delete(key);cache.set(key,value);}
  manifest(capture){
    if(this.manifests.has(capture)){const m=this.manifests.get(capture);this.touch(this.manifests,capture,m);return m;}
    const directory=resolve(this.directory,capture);
    if(realpathSync(directory)!==directory)throw Error('Public snapshot directory escapes store');
    let path;try{path=realpathSync(resolve(directory,'manifest.json'));}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(!contained(directory,path))throw Error('Public snapshot manifest escapes directory');
    const manifest=JSON.parse(this.read(path,'utf8'));
    if(!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw Error('Invalid public snapshot manifest');
    this.verifyBehavior(manifest);
    for(const[name,metadata]of Object.entries(manifest.files)){
      if(!filePattern.test(name)||!metadata||!hashPattern.test(metadata.sha256)||typeof metadata.contentType!=='string'||!metadata.contentType||/[\r\n]/.test(metadata.contentType))throw Error('Invalid public snapshot file metadata');
    }
    const value={directory,files:manifest.files};this.touch(this.manifests,capture,value);
    while(this.manifests.size>this.maxManifests)this.manifests.delete(this.manifests.keys().next().value);
    return value;
  }
  entry(url){
    const match=/^\/reference-pages\/([^/]+)\/([^/]+)$/.exec(url);
    if(!match||!this.captures.has(match[1])||!filePattern.test(match[2]))return;
    const manifest=this.manifest(match[1]);if(!manifest)return;const metadata=Object.hasOwn(manifest.files,match[2])?manifest.files[match[2]]:null;
    if(metadata)return{...metadata,directory:manifest.directory,name:match[2]};
  }
  has(url){return Boolean(this.entry(url));}
  verified(entry){
    const path=realpathSync(resolve(entry.directory,entry.name));
    if(!contained(entry.directory,path))throw Error('Public snapshot file escapes directory');
    const content=this.read(path);this.bodyReads++;
    if(createHash('sha256').update(content).digest('hex')!==entry.sha256)throw Error('Public snapshot hash mismatch');
    return content;
  }
  get(url){
    const entry=this.entry(url);if(!entry)return;
    if(this.bodies.has(url)){const body=this.bodies.get(url);if(body.sha256===entry.sha256){this.touch(this.bodies,url,body);return{content:body.content,contentType:entry.contentType};}this.cachedBytes-=body.content.length;this.bodies.delete(url);}
    const content=this.verified(entry);
    if(content.length<=this.maxBytes){
      while(this.cachedBytes+content.length>this.maxBytes||this.bodies.size>=this.maxBodies){const key=this.bodies.keys().next().value;this.cachedBytes-=this.bodies.get(key).content.length;this.bodies.delete(key);}
      this.bodies.set(url,{content,sha256:entry.sha256});this.cachedBytes+=content.length;
    }
    return{content,contentType:entry.contentType};
  }
  audit(){
    this.manifests.clear();
    let files=0,bytes=0,captures=0;
    for(const capture of this.captures){const manifest=this.manifest(capture);if(!manifest)continue;captures++;for(const[name,metadata]of Object.entries(manifest.files)){const content=this.verified({...metadata,directory:manifest.directory,name});files++;bytes+=content.length;}}
    return{captures,files,bytes,cachedBytes:this.cachedBytes};
  }
}
