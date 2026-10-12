import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// One manifest per tenant statement build; each document is bound to its own tenant file prefix.
const manifests=[['./research/starnik-statements.json',/^gmg-inv-[a-z]+\.pdf$/],['./research/onswc-statements.json',/^onswc-inv-[a-z]+\.pdf$/],['./research/inframark-statements.json',/^inframark-inv-[a-z]+\.pdf$/]].map(([path,pattern])=>{const m=JSON.parse(readFileSync(new URL(path,import.meta.url)));if(m.schema!==1||m.synthetic!==true||!Array.isArray(m.documents))throw Error('Invalid statement manifest');return{m,pattern};});
const manifest={documents:manifests.flatMap(({m,pattern})=>m.documents.map(d=>({...d,pattern})))};
const fields=['siteId','invoiceId','accountId','number','period','dueDate','amountCents','customerNumber','name'];
export function starnikStatementDocument(projection){
  const document=manifest.documents.find(d=>fields.every(key=>d[key]===projection[key]));
  if(!document)return null; // Changed/new invoices require a new statement, never a stale template.
  if(!document.pattern.test(document.file))throw Error('Invalid statement filename');
  const bytes=readFileSync(new URL('./output/pdf/'+document.file,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==document.sha256)throw Error('Statement hash mismatch');
  return {filename:document.file,sha256:document.sha256,bytes,synthetic:true};
}
