/**
 * Type declarations for jsfive package.
 * jsfive is a pure JavaScript HDF5 reader.
 */
declare module "jsfive" {
  export class File {
    constructor(buffer: ArrayBuffer, filename?: string);
    get(path: string): Dataset | Group | null;
    keys: string[];
  }

  export interface Dataset {
    value: unknown;
    shape: number[];
    dtype: string;
    attrs: Record<string, unknown>;
  }

  export interface Group {
    keys: string[];
    attrs: Record<string, unknown>;
    get(path: string): Dataset | Group | null;
  }
}
