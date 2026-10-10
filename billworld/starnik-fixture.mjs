// Synthetic benchmark credentials, never production identities.
export function starnikFixtureCredentials(site,accountIds){
 const config=site?.construction_account_credentials;
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).length!==accountIds.length)throw Error('Tenant fixture credentials unavailable');
 const usernames=new Set(),codes=new Set(),result={};
 for(const id of accountIds){
  const v=config[id];
  if(!v||typeof v.username!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9.@_-]{5,49}$/.test(v.username)||usernames.has(v.username.toLowerCase()))throw Error('Tenant fixture username invalid or duplicated');
  if(typeof v.password!=='string'||v.password.length<8||v.password.length>24||!/[a-zA-Z]/.test(v.password)||!/[0-9]/.test(v.password)||!/[!@#$%^&*._-]/.test(v.password)||/[\s<>]/.test(v.password))throw Error('Tenant fixture password unavailable');
  if(typeof v.security_code!=='string'||!/^[a-zA-Z0-9.@_-]{1,100}$/.test(v.security_code)||codes.has(v.security_code))throw Error('Tenant fixture security code invalid or duplicated');
  if(typeof v.service_zip!=='string'||!/^\d{5}$/.test(v.service_zip))throw Error('Tenant fixture service ZIP unavailable');
  usernames.add(v.username.toLowerCase());codes.add(v.security_code);result[id]={username:v.username,password:v.password,securityCode:v.security_code,serviceZip:v.service_zip};
 }
 return result;
}
