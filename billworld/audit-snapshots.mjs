import {auditPublicSnapshots} from './server.mjs';
const begin=performance.now();
const result=auditPublicSnapshots();
console.log(JSON.stringify({kind:'reconstructed_public_snapshot_integrity',...result,audit_ms:performance.now()-begin,meaning:'Reconstructed asset hashes and approved local behavior; not original-site fidelity certification.'},null,2));
