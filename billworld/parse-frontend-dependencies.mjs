import {parse as parseJS,version as acornVersion} from 'acorn';
import * as css from 'css-tree';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function dependencies(source,kind){
  if(typeof source!=='string'||!['script','style'].includes(kind))throw Error('Expected script/style source');
  const references=[],issues=[];let omitted=0,nodes=0,mode=kind,issueCount=0,referenceBytes=0;
  const issue=value=>{issueCount++;if(issues.length<1000)issues.push(value);};
  const add=(specifier,syntax,node,referenceKind)=>{if(typeof specifier!=='string'){issue({reason:'computed_specifier',syntax,start:node.start??node.loc?.start.offset});return;}if(specifier.length>8192||references.length>=10000){omitted++;return;}const reference={specifier,syntax,kind:referenceKind,start:node.start??node.loc?.start.offset,end:node.end??node.loc?.end.offset};const bytes=Buffer.byteLength(JSON.stringify(reference));if(referenceBytes+bytes>1024*1024){omitted++;return;}referenceBytes+=bytes;references.push(reference);};
  if(kind==='script'){
    let ast;try{ast=parseJS(source,{ecmaVersion:'latest',sourceType:'module'});mode='module';}catch(moduleError){try{ast=parseJS(source,{ecmaVersion:'latest',sourceType:'script'});mode='script';}catch(error){return{status:'parse_error',error:error.message.slice(0,500),references:[],issues:[],parser:'acorn',parser_version:acornVersion};}}
    const stack=[ast];while(stack.length){const n=stack.pop();if(!n||typeof n!=='object')continue;nodes++;
      if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(n.type)&&n.source)add(n.source.value,n.type,n.source,'script');
      if(n.type==='ImportExpression'){const value=n.source.type==='Literal'?n.source.value:n.source.type==='TemplateLiteral'&&n.source.expressions.length===0?n.source.quasis[0].value.cooked:null;add(value,'ImportExpression',n.source,'script');}
      if(n.type==='NewExpression'&&n.callee.type==='Identifier'&&n.callee.name==='URL'&&n.arguments[1]?.type==='MemberExpression'&&n.arguments[1].object?.type==='MetaProperty'&&n.arguments[1].object.meta?.name==='import'&&n.arguments[1].object.property?.name==='meta'&&!n.arguments[1].computed&&n.arguments[1].property.name==='url')add(n.arguments[0]?.type==='Literal'?n.arguments[0].value:null,'import-meta-url',n,'resource');
      for(const v of Object.values(n)){if(Array.isArray(v)){for(let i=v.length-1;i>=0;i--)if(v[i]&&typeof v[i]==='object')stack.push(v[i]);}else if(v&&typeof v==='object'&&typeof v.type==='string')stack.push(v);}
    }
  }else{
    const errors=[];let ast;try{ast=css.parse(source,{positions:true,parseCustomProperty:true,onParseError:error=>errors.push(error.message.slice(0,500))});}catch(error){return{status:'parse_error',error:error.message.slice(0,500),references:[],issues:[],parser:'css-tree'};}
    const imports=new WeakSet();css.walk(ast,n=>{nodes++;if(n.type==='Atrule'&&n.name.toLowerCase()==='import'){const first=n.prelude?.children?.first;if(first&&['String','Url'].includes(first.type)){imports.add(first);add(first.value,'css-import',first,'style');}else issue({reason:'unparsed_css_import',start:n.loc?.start.offset});}if(n.type==='Url'&&!imports.has(n))add(n.value,'css-url',n,'resource');if(n.type==='Raw')issue({reason:'raw_css_syntax',start:n.loc?.start.offset});});
    for(const error of errors)issue({reason:'css_recovery',error});
  }
  if(omitted)issue({reason:'reference_limit',omitted});
  const result={status:issueCount?'partial':'parsed',parse_mode:mode,parser:kind==='script'?'acorn':'css-tree',parser_version:kind==='script'?acornVersion:'3.2.1',nodes,offset_unit:'utf16_code_units',references,issues,issues_omitted:Math.max(0,issueCount-issues.length)};
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const input=JSON.parse(readFileSync(0,'utf8'));
  if((input.source||'').length>8*1024*1024)throw Error('Source exceeds capture bound');
  process.stdout.write(JSON.stringify(dependencies(input.source,input.kind))+'\n');
}
