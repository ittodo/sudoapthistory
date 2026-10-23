export function restoreApartmentEntry(entry: Record<string, any>, index?: Record<string, any> | null): Record<string, any>;
export function createApartmentEntryReader(load: (path: string, hash?: string) => Promise<ArrayBuffer | Uint8Array>, options?: {verified?: boolean; maxFiles?: number}): (key: string) => Promise<Record<string, any>>;
export function apartmentEntry(key: string): Promise<Record<string, any>>;
