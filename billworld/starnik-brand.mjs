// Explicit tenant branding; missing configuration must not inherit another biller.
export function starnikBrand(site){
 const name=site?.name,mailName=site?.runtime?.mail_display_name,
  paymentPrefix=site?.runtime?.payment_confirmation_prefix,autopayPrefix=site?.runtime?.autopay_confirmation_prefix;
 for(const value of [name,mailName])if(typeof value!=='string'||!value.trim()||value.length>150||/[\r\n\x00-\x1f]/.test(value))throw Error('Tenant branding unavailable');
 for(const value of [paymentPrefix,autopayPrefix])if(typeof value!=='string'||!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(value))throw Error('Tenant confirmation prefix unavailable');
 return {name,mailName,paymentPrefix,autopayPrefix};
}
