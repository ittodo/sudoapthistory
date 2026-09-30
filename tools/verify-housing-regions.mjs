import{verifyHousingSales}from'./verify-housing-sales.mjs';import{verifyHousingDetails}from'./verify-housing-details.mjs';
import{regionalReader,verifyRegionalData}from'./regional-data.mjs';import{existsSync,readFileSync}from'node:fs';import{join}from'node:path';import assert from'node:assert/strict';
const site=process.argv[2];if(!site)throw Error('SITE required');const d=regionalReader(site,'daily'),r=regionalReader(site,'rental');if(d.manifest.schema!==3||r.manifest.schema!==3)throw Error('Packed schema required');assert.deepEqual(d.manifest.regional.quarters,r.manifest.regional.quarters);if(d.manifest.regional.authority!==r.manifest.regional.authority)throw Error('Authority mismatch');
for(const code of d.table.regions.keys()){for(const legacy of ['base','months'])if(existsSync(join(site,'data/daily/regions',code,legacy)))throw Error('Retired public path recreated');}
if(existsSync(join(site,'data/daily/regions/baseline.json')))throw Error('Retired public baseline recreated');
for(const[p,h]of Object.entries(d.manifest.sources))if(r.manifest.sources[p]&&r.manifest.sources[p]!==h)throw Error('Shared source mismatch');
console.log(JSON.stringify({status:'PASS',schema:3,legacyCompatibility:false,daily:verifyRegionalData(site,'daily'),rental:verifyRegionalData(site,'rental'),sales:verifyHousingSales(site),details:verifyHousingDetails(site)}));
