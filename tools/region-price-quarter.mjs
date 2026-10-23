import {gzipSync} from 'node:zlib';

export const FORMAT='gzip-json';
// Keep the published representation stable. Benchmark alternate transports
// separately; a .bin suffix does not imply an indexed binary payload.
export function encodeRegionQuarter(frames){
 return gzipSync(JSON.stringify({schema:1,months:frames}),{level:6});
}
