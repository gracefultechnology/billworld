import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest=JSON.parse(readFileSync(new URL('./research/paymentus-statements.json',import.meta.url)));
if(manifest.schema!==1||manifest.synthetic!==true||!Array.isArray(manifest.documents))throw Error('Invalid statement manifest');
const fields=['siteId','invoiceId','accountId','number','period','dueDate','amountCents','customerNumber','name','serviceAddress'];
export function paymentusStatementDocument(projection){
  const document=manifest.documents.find(d=>fields.every(key=>d[key]===projection[key]));
  if(!document)return null; // Changed/new invoices require a new statement, never a stale template.
  if(!/^batavia-inv-[a-z]+\.pdf$/.test(document.file))throw Error('Invalid statement filename');
  const bytes=readFileSync(new URL('./output/pdf/'+document.file,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==document.sha256)throw Error('Statement hash mismatch');
  return {filename:document.file,sha256:document.sha256,bytes,synthetic:true};
}
