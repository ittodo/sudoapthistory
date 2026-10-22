// Keep the CLI adapter separate from the file-producing dependency graph.
import {buildHousingRegions} from './housing-region-builder.mjs';
export {buildHousingRegions};
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[root,output,codecPath,...codes]=process.argv.slice(2);if(!root||!output||!codecPath)throw Error('SITE OUTPUT CODEC [LAWD ...] required');const codec=await import(pathToFileURL(codecPath));const report=buildHousingRegions(root,output,codec,{codes:codes.length?codes:null});console.log(JSON.stringify({status:report.status,regions:report.metrics.length,rows:report.metrics.reduce((n,r)=>n+r.rows,0),bytes:report.metrics.reduce((n,r)=>n+r.bytes,0)}));}
