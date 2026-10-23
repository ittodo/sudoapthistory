export function createApartmentRecordReader(load:(path:string,hash:string)=>Promise<ArrayBuffer|Uint8Array>,options?:{verified?:boolean;maxFiles?:number;maxBytes?:number}):(ref:readonly [string,string,string],metadata?:Record<string,any>)=>Promise<Record<string,any>|undefined>;
export const APARTMENT_FORMAT:string;
