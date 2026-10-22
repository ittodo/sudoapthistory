import {buildContractArchive} from './build-contract-archive.mjs';
import {buildApartmentEntries} from './build-apartment-entries.mjs';
import{GenerationFileSession}from'./housing-generation-batch.mjs';
import {performance} from 'node:perf_hooks';
// Invoked only by the official Rust generator, using its verified regional scratch outputs.
import{createNativeReaders}from'./housing-native-readers.mjs';

import{readFileSync}from'./cache-store.mjs';import{resolve}from'node:path';
import{buildHousingSales}from'./build-housing-sales.mjs';import{buildHousingDetails}from'./build-housing-details.mjs';import{buildHousingRegions}from'./build-housing-regions.mjs';import*as codec from'../js/generated/housing-columns.mjs';import'../js/regional-data.js';
const spec=JSON.parse(readFileSync(process.argv[2])),site=resolve(spec.site);
const generationSession=spec.fileGenerationBatch==null?null:new GenerationFileSession({site,output:resolve(spec.output),cache:spec.cache,batch:spec.fileGenerationBatch,engine:spec.generationEngine??null});
const {readers,nativeInputs}=createNativeReaders(spec,site,generationSession);
const timings={},phase=(name,fn)=>{const start=performance.now();const result=fn();timings[name]=(performance.now()-start)/1000;return result;};const result=phase('regionPacking',()=>buildHousingRegions(site,resolve(spec.output),codec,{readers,previousRoot:spec.previous,cacheDir:spec.cache,generationSession}));const sales=phase('saleDetails',()=>buildHousingSales(site,resolve(spec.output),spec.excludedSales||[],{cacheDir:spec.cache,generationSession}));const details=phase('rentalDetails',()=>buildHousingDetails(site,resolve(spec.output),spec.previous,{cacheDir:spec.cache,generationSession}));const archive=spec.contractDatabase?phase('contractArchive',()=>buildContractArchive({packed:resolve(spec.output),database:spec.contractDatabase,generationSession})):null;const entries=phase('apartmentEntries',()=>buildApartmentEntries(resolve(spec.output),{fallback:site}));console.log(JSON.stringify({status:result.status,timings,sales,details,archive,entries,nativeInputs:nativeInputs.metrics,consumption:generationSession?.finish()??{status:'NOT_RUN'},packingReuse:{quarters:result.metrics.reduce((n,r)=>n+(r.quartersReused||0),0),years:result.metrics.reduce((n,r)=>n+(r.yearsReused||0),0),monthsDecoded:result.metrics.reduce((n,r)=>n+(r.monthsDecoded||0),0),regions:result.metrics},regions:result.metrics.length,rows:result.metrics.reduce((n,r)=>n+r.rows,0),bytes:result.metrics.reduce((n,r)=>n+r.bytes,0)}));
