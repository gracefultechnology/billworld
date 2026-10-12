// Derive an additional synthetic GMG statement from the reviewed ReportLab fixture.
// Usage: node billworld/starnik-statement-variant.mjs  (rewrites output/pdf/gmg-inv-cabin.pdf deterministically)
import {readFileSync,writeFileSync} from 'node:fs';
import {inflateSync,deflateSync} from 'node:zlib';
const root=new URL('./',import.meta.url),template=readFileSync(new URL('output/pdf/gmg-inv-current.pdf',root)).toString('latin1');
const a85decode=s=>{s=s.replace(/\s/g,'').replace(/~>$/,'');const out=[];let group=[];for(const ch of s){if(ch==='z'&&!group.length){out.push(0,0,0,0);continue;}group.push(ch.charCodeAt(0)-33);if(group.length===5){let n=0;for(const d of group)n=n*85+d;out.push(n>>>24&255,n>>>16&255,n>>>8&255,n&255);group=[];}}if(group.length){const pad=group.length;while(group.length<5)group.push(84);let n=0;for(const d of group)n=n*85+d;out.push(...[n>>>24&255,n>>>16&255,n>>>8&255,n&255].slice(0,pad-1));}return Buffer.from(out);};
const a85encode=b=>{let out='';for(let i=0;i<b.length;i+=4){const chunk=[...b.subarray(i,i+4)],pad=4-chunk.length;while(chunk.length<4)chunk.push(0);let n=((chunk[0]<<24)>>>0)+(chunk[1]<<16)+(chunk[2]<<8)+chunk[3];if(n===0&&!pad){out+='z';continue;}const digits=[];for(let k=0;k<5;k++){digits.unshift(String.fromCharCode(n%85+33));n=Math.floor(n/85);}out+=digits.join('').slice(0,5-pad);}return out+'~>';};
const match=/8 0 obj\n<<\n\/Filter \[ \/ASCII85Decode \/FlateDecode \] \/Length \d+\n>>\nstream\n([\s\S]*?)endstream/.exec(template);if(!match)throw Error('Template stream unavailable');
let content=inflateSync(a85decode(match[1])).toString('latin1');
const swaps=[['(1001048)','(3003077)'],['(2026-10-1048)','(2026-10-3077)'],['(2026-10-20)','(2026-10-22)'],['($84.32)','($61.50)']];
for(const[from,to]of swaps){if(content.split(from).length!==2)throw Error('Template field not unique: '+from);content=content.replace(from,to);}
const stream=a85encode(deflateSync(Buffer.from(content,'latin1'),{level:9}))+'\n';
let pdf=template.slice(0,match.index)+'8 0 obj\n<<\n/Filter [ /ASCII85Decode /FlateDecode ] /Length '+stream.length+'\n>>\nstream\n'+stream+'endstream'+template.slice(match.index+match[0].length);
pdf=pdf.replace('(Billworld synthetic Greater Minnesota Gas statement)','(Billworld synthetic Greater Minnesota Gas statement 3003077)');
const body=pdf.slice(0,pdf.indexOf('xref\n')),offsets=[];for(let n=1;n<=8;n++){const at=body.indexOf('\n'+n+' 0 obj\n');if(at<0)throw Error('Object missing '+n);offsets.push(at+1);}
const xref='xref\n0 9\n0000000000 65535 f \n'+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
const trailer=pdf.slice(pdf.indexOf('trailer\n'),pdf.indexOf('startxref'));
pdf=body+xref+trailer+'startxref\n'+body.length+'\n%%EOF\n';
if(inflateSync(a85decode(/stream\n([\s\S]*?)endstream/.exec(pdf.slice(pdf.indexOf('8 0 obj')))[1])).toString('latin1')!==content)throw Error('Round trip failed');
writeFileSync(new URL('output/pdf/gmg-inv-cabin.pdf',root),Buffer.from(pdf,'latin1'));
