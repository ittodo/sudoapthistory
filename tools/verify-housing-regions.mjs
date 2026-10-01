import {createDataValidationProof} from './data-validation-proof.mjs';
import {verifyApartmentSale} from './verify-apartment-sale.mjs';
import {ValidationSession,manifestDependencies} from './validation-session.mjs';
import {performance} from 'node:perf_hooks';
import{verifyHousingSales}from'./verify-housing-sales.mjs';import{verifyHousingDetails}from'./verify-housing-details.mjs';
import{regionalReader,verifyRegionalData}from'./regional-data.mjs';import{existsSync,readFileSync}from'node:fs';import{join}from'node:path';import assert from'node:assert/strict';
const site=process.argv[2];if(!site)throw Error('SITE required');const d=regionalReader(site,'daily'),r=regionalReader(site,'rental');if(d.manifest.schema!==3||r.manifest.schema!==3)throw Error('Packed schema required');assert.deepEqual(d.manifest.regional.quarters,r.manifest.regional.quarters);if(d.manifest.regional.authority!==r.manifest.regional.authority)throw Error('Authority mismatch');
for(const code of d.table.regions.keys()){for(const legacy of ['base','months'])if(existsSync(join(site,'data/daily/regions',code,legacy)))throw Error('Retired public path recreated');}
if(existsSync(join(site,'data/daily/regions/baseline.json')))throw Error('Retired public baseline recreated');
for(const[p,h]of Object.entries(d.manifest.sources))if(r.manifest.sources[p]&&r.manifest.sources[p]!==h)throw Error('Shared source mismatch');
const timings={},session=new ValidationSession(site);
const phase=(name,fn)=>{const started=performance.now();const result=fn();timings[name]=(performance.now()-started)/1000;return result;};
const daily=phase('daily',()=>verifyRegionalData(site,'daily')),rental=phase('rental',()=>verifyRegionalData(site,'rental'));
const sales=phase('sales',()=>session.check('producer-sale-details',manifestDependencies(site,['data/apartments/index.json','data/sale-details/index.json','data/daily/index.json']),()=>verifyHousingSales(site)));
const details=phase('details',()=>session.check('rental-details',manifestDependencies(site,['data/contracts/index.json','data/apartment-rent/index.json','data/apartments/index.json','data/rental/index.json']),()=>verifyHousingDetails(site)));
const apartment=phase('apartment',()=>verifyApartmentSale(site,{verifiedSales:sales}));session.flush();const result={status:'PASS',schema:3,legacyCompatibility:false,daily,rental,sales,details,apartment,timings,validation:session.stats,validationMisses:session.misses,validationCacheStatus:session.cacheStatus};createDataValidationProof(site,result);console.log(JSON.stringify(result));
