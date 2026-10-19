import {createDataValidationProof,currentReviewMetadataCheck} from './data-validation-proof.mjs';
import {verifyApartmentSale} from './verify-apartment-sale.mjs';
import {ValidationSession,manifestDependencies} from './validation-session.mjs';
import {performance} from 'node:perf_hooks';
import{verifyHousingSales}from'./verify-housing-sales.mjs';import{verifyHousingDetails}from'./verify-housing-details.mjs';
import{regionalReader,verifyRegionalData}from'./regional-data.mjs';import{existsSync}from'node:fs';import{join,resolve}from'node:path';import {pathToFileURL} from 'node:url';import assert from'node:assert/strict';
export function verifyHousingRegions(site){
if(!site)throw Error('SITE required');const d=regionalReader(site,'daily'),r=regionalReader(site,'rental');if(d.manifest.schema!==3||r.manifest.schema!==3)throw Error('Packed schema required');assert.deepEqual(d.manifest.regional.quarters,r.manifest.regional.quarters);if(d.manifest.regional.authority!==r.manifest.regional.authority)throw Error('Authority mismatch');
for(const code of d.table.regions.keys()){for(const legacy of ['base','months'])if(existsSync(join(site,'data/daily/regions',code,legacy)))throw Error('Retired public path recreated');}
if(existsSync(join(site,'data/daily/regions/baseline.json')))throw Error('Retired public baseline recreated');
for(const[p,h]of Object.entries(d.manifest.sources))if(r.manifest.sources[p]&&r.manifest.sources[p]!==h)throw Error('Shared source mismatch');
const timings={},session=new ValidationSession(site);
const phase=(name,fn)=>{const started=performance.now();const result=fn();timings[name]=(performance.now()-started)/1000;return result;};
const daily=phase('daily',()=>verifyRegionalData(site,'daily')),rental=phase('rental',()=>verifyRegionalData(site,'rental'));
const sales=phase('sales',()=>session.check('producer-sale-details',manifestDependencies(site,['data/apartments/index.json','data/sale-details/index.json','data/daily/index.json']),()=>verifyHousingSales(site)));
const details=phase('details',()=>session.check('rental-details',manifestDependencies(site,['data/contracts/index.json','data/apartment-rent/index.json','data/apartments/index.json','data/rental/index.json']),()=>verifyHousingDetails(site)));
const apartment=phase('apartment',()=>verifyApartmentSale(site,{verifiedSales:sales}));session.flush();const result={status:'PASS',schema:3,legacyCompatibility:false,daily,rental,sales,details,apartment,timings,validation:session.stats,validationMisses:session.misses,validationCacheStatus:session.cacheStatus};
const currentReview=currentReviewMetadataCheck(site);if(currentReview)result.currentReview=currentReview;
createDataValidationProof(site,result);return result;
}
// Rust canonical paths can use the Windows \\?\ prefix. File URLs normalize it.
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(verifyHousingRegions(process.argv[2])));
