import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildTransportCodec(generated,output){
 generated=realpathSync(generated);output=resolve(output);mkdirSync(output,{recursive:true});
 const source=join(generated,'transport_packed_columns.ts'),runtime=join(generated,'packed_columns.ts');
 const extracted=await build({entryPoints:[source],bundle:true,platform:'node',format:'esm',write:false});
 const module=await import('data:text/javascript;base64,'+Buffer.from(extracted.outputFiles[0].contents).toString('base64'));
 if(module.unsupportedPackedTables.length)throw Error('Unsupported transport tables');
 const schemas=Object.fromEntries(Object.entries(module.packedLayouts).map(([name,layout])=>[name.split('.').at(-1),{...layout,fingerprint:hash(JSON.stringify(layout))}]));
 const entry='export * from '+JSON.stringify(runtime.replaceAll('\\','/'))+'; export const schemas='+JSON.stringify(schemas)+';';
 const result=await build({stdin:{contents:entry,resolveDir:generated,loader:'ts'},bundle:true,platform:'neutral',format:'esm',write:false,target:'es2022',minifyWhitespace:true});
 writeFileSync(join(output,'transport-columns.mjs'),result.outputFiles[0].contents);
 const proof={schema:1,layoutSource:hash(readFileSync(source)),runtimeSource:hash(readFileSync(runtime)),output:hash(result.outputFiles[0].contents),tables:Object.keys(schemas)};
 writeFileSync(join(output,'transport-generation-proof.json'),JSON.stringify(proof,null,2)+'\n');return proof;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.length!==4)throw Error('Usage: node tools/build-transport-codec.mjs GENERATED_TYPESCRIPT OUTPUT');console.log(JSON.stringify(await buildTransportCodec(...process.argv.slice(2))));}
