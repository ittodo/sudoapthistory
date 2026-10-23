export const FORMAT: 'packed-records-v1';
export const MAGIC: 'PGRCD001';
export function encodeRecords(entries: Iterable<readonly [string, unknown]>): Uint8Array;
export function openRecords(bytes: ArrayBuffer | ArrayBufferView): {count: number; keys(): string[]; get(key: string): unknown};
