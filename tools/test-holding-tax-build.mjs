import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,statSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildHoldingTax,calculatorAssets} from './build-holding-tax.mjs';

test('calculator build ignores invalid rental data and leaves deployment/cache outputs untouched',()=>{
  const root=mkdtempSync(join(tmpdir(),'nodo-calc-build-'));
  try{
    for(const path of calculatorAssets){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),path);}
    const protectedPaths=['data/rental/index.json','cloudflare/dist/public/deployment-manifest.json','cloudflare/dist/region-price-cache-v1/sentinel','cloudflare/dist/rental-map-cache-v1/sentinel'];
    for(const path of protectedPaths){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),'invalid data / do not touch');utimesSync(join(root,path),1000,1000);}
    const result=buildHoldingTax(root);
    assert.equal(result.assets,calculatorAssets.length);
    const manifest=JSON.parse(readFileSync(join(result.output,'local-manifest.json')));
    assert.equal(manifest.deployable,false);
    assert.equal(existsSync(join(result.output,'data')),false);
    assert.equal(existsSync(join(result.output,'deployment-manifest.json')),false);
    for(const file of manifest.files){const bytes=readFileSync(join(result.output,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
    assert.equal(buildHoldingTax(root).written,0);
    for(const path of protectedPaths){assert.equal(readFileSync(join(root,path),'utf8'),'invalid data / do not touch');assert.equal(statSync(join(root,path)).mtimeMs,1000000);}
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('missing calculator inputs fail before writing local output',()=>{
  const root=mkdtempSync(join(tmpdir(),'nodo-calc-missing-'));
  try{assert.throws(()=>buildHoldingTax(root),/ENOENT/);assert.equal(existsSync(join(root,'cloudflare/dist/holding-tax-local')),false);}
  finally{rmSync(root,{recursive:true,force:true});}
});
