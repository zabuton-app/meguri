export const SOURCE: string;
export const OUTPUT: string;
export function compileForces(): Promise<Uint8Array>;
export function moduleText(binary: Uint8Array): string;
