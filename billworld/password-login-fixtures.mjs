const passwordLoginFixtures = new Map([
  ['batavia-utilities', { taskId: 'batavia-email-login-v1', label: 'City of Batavia', identity: 'email', entryPath: '/paymentus/login' }],
  ['greater-minnesota-gas', { taskId: 'gmg-username-login-v1', label: 'Greater Minnesota Gas', identity: 'username', entryPath: '/RP_Default.aspx', fallback: 'starnik' }],
  ['onswc', { taskId: 'onswc-username-login-v1', label: 'ONSWC', identity: 'username', entryPath: '/RP_Default.aspx', fallback: 'starnik' }],
  ['inframark', { taskId: 'inframark-username-login-v1', label: 'Inframark', identity: 'username', entryPath: '/RP_Default.aspx', fallback: 'starnik' }],
  ['lockwood', { taskId: 'lockwood-username-login-v1', label: 'City of Lockwood', identity: 'cusiUsername', entryPath: '/Account/Login', fallback: 'cusi' }],
]);

export const passwordLoginFixture = (siteId) => passwordLoginFixtures.get(siteId);
