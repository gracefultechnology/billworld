// Gmail query subset used by the mailbox UI and Grace's managed mail reader.
// Braces mean OR; separate terms mean AND. Epoch-second windows follow the
// Gmail API format: https://developers.google.com/workspace/gmail/api/guides/filtering
const tokens=query=>String(query).match(/\{[^{}]*\}|(?:[^\s"]|"[^"]*")+/g)||[];
function term(message, raw) {
  const value=raw.replaceAll('"','');
  if(value==='is:unread')return Boolean(message.unread);
  if(value==='has:attachment')return (message.attachments||[]).length>0;
  if(value.startsWith('from:'))return message.from.toLowerCase().includes(value.slice(5).toLowerCase());
  if(value.startsWith('to:'))return message.to.toLowerCase().includes(value.slice(3).toLowerCase());
  if(value.startsWith('subject:'))return message.subject.toLowerCase().includes(value.slice(8).toLowerCase());
  const window=/^(after|before):(.*)$/.exec(value);
  if(window){
    if(!/^\d{1,12}$/.test(window[2]))return false;
    const boundary=Number(window[2])*1000,received=Date.parse(message.receivedAt);
    return Number.isFinite(received) && (window[1]==='after' ? received>boundary : received<boundary);
  }
  return `${message.subject} ${message.text}`.toLowerCase().includes(value.toLowerCase());
}
export function matchesMailQuery(message,query='') {
  return tokens(query).every(token=>token.startsWith('{')&&token.endsWith('}')
    ? tokens(token.slice(1,-1)).some(alternative=>term(message,alternative))
    : term(message,token));
}
