import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildHousingCodec(generated,output,rustGenerated=null,nativeOutput=null){
 if(Boolean(rustGenerated)!==Boolean(nativeOutput))throw Error('Rust source and native destination must be supplied together');
 generated=realpathSync(generated);output=resolve(output);mkdirSync(output,{recursive:true});
 const source=join(generated,'housing_packed_columns.ts'),runtime=join(generated,'packed_columns.ts');
 const extracted=await build({entryPoints:[source],bundle:true,platform:'node',format:'esm',write:false});
 const module=await import('data:text/javascript;base64,'+Buffer.from(extracted.outputFiles[0].contents).toString('base64'));
 if(module.unsupportedPackedTables.length)throw Error('Housing table cannot be packed: '+module.unsupportedPackedTables.join(','));
 const schemas={};for(const [name,layout]of Object.entries(module.packedLayouts)){schemas[name.split('.').at(-1)]={...layout,fingerprint:hash(JSON.stringify(layout))};}
 const entry='export * from '+JSON.stringify(runtime.replaceAll('\\','/'))+'; export const schemas='+JSON.stringify(schemas)+';';
 const bundle=await build({stdin:{contents:entry,resolveDir:generated,loader:'ts'},bundle:true,platform:'neutral',format:'esm',write:false,target:'es2022'});
 writeFileSync(join(output,'housing-columns.mjs'),bundle.outputFiles[0].contents);
 writeFileSync(join(output,'housing-layouts.json'),JSON.stringify(schemas));
 const proof={schema:1,layoutSource:hash(readFileSync(source)),runtimeSource:hash(readFileSync(runtime)),files:{'housing-columns.mjs':hash(bundle.outputFiles[0].contents),'housing-layouts.json':hash(JSON.stringify(schemas))},tables:Object.keys(schemas)};
 if(rustGenerated){
  const rustSource=readFileSync(join(realpathSync(rustGenerated),'packed_columns.rs'));
  nativeOutput=resolve(nativeOutput);if(nativeOutput===generated||nativeOutput===realpathSync(rustGenerated))throw Error('Generated input must not be overwritten');
  mkdirSync(nativeOutput,{recursive:true});
  const layout=JSON.stringify(schemas);writeFileSync(join(nativeOutput,'housing_columns.rs'),rustSource);writeFileSync(join(nativeOutput,'housing-layouts.json'),layout);
  proof.nativeFiles={'housing_columns.rs':hash(rustSource),'housing-layouts.json':hash(layout)};
  writeFileSync(join(nativeOutput,'housing-codegen-proof.json'),JSON.stringify(proof,null,2));
 }
 writeFileSync(join(output,'generation-proof.json'),JSON.stringify(proof,null,2));return proof;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(![4,6].includes(process.argv.length))throw Error('Usage: node tools/build-housing-codec.mjs GENERATED_TYPESCRIPT OUTPUT [GENERATED_RUST NATIVE_OUTPUT]' );console.log(JSON.stringify(await buildHousingCodec(...process.argv.slice(2))));}
