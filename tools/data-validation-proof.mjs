// A producer completion record bound to reviewed code and exact published inputs.
// It contains no private caches, databases, logs or credentials.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {validationEngine,manifestDependencies} from './validation-session.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export const proofPath='data/.housing-validation.json';
export const proofManifests=['data/apartments/index.json','data/sale-details/index.json','data/daily/index.json','data/contracts/index.json','data/apartment-rent/index.json','data/rental/index.json'];
export function createDataValidationProof(root,checks){
 if(checks.status!=='PASS'||checks.schema!==3||checks.sales?.status!=='PASS'||checks.details?.status!=='PASS'||checks.apartment?.verified!==true)throw Error('Complete verified housing checks required');
 const body={schema:1,engine:validationEngine(root),sources:manifestDependencies(root,proofManifests),checks:{status:'PASS',schema:3,saleRows:checks.sales.rows,rentalRows:checks.details.contracts,excluded:checks.sales.excluded,unmatched:checks.details.unmatched}};
 const proof={...body,digest:hash(JSON.stringify(body))};writeFileSync(join(root,proofPath),JSON.stringify(proof));return proof;
}
export function dataValidationProof(root,{full=process.env.NODO_FULL_VERIFY==='1'}={}){
 if(full)return {status:'FULL_REQUIRED'};
 const path=join(root,proofPath);if(!existsSync(path))return {status:'MISSING'};
 if(lstatSync(path).isSymbolicLink())throw Error('Validation proof symlink');
 let proof;try{proof=JSON.parse(readFileSync(path));}catch{return {status:'INVALID'};}
 const {digest,...body}=proof;
 if(proof.schema!==1||digest!==hash(JSON.stringify(body))||proof.engine!==validationEngine(root)||proof.checks?.status!=='PASS'||proof.checks?.schema!==3)return {status:'INVALID'};
 // Always read current bytes. A changed input causes normal semantic checks;
 // a byte inconsistent with its own dataset manifest remains a hard failure.
 const current=manifestDependencies(root,proofManifests);
 if(JSON.stringify(current)!==JSON.stringify(proof.sources))return {status:'INPUT_CHANGED'};
 return {status:'VERIFIED',digest,checks:proof.checks};
}
