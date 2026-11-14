import type { Features, Reconstruction } from "./types.ts";
/** Unit quaternion (w, x, y, z) of a row-major rotation matrix. */
export declare function quaternion(R: ArrayLike<number>): [number, number, number, number];
/** The reconstruction as COLMAP binary files (`features`: those it was built from). */
export declare function toColmapBinary(rec: Reconstruction, features: Features[]): Record<"cameras.bin" | "images.bin" | "points3D.bin", Uint8Array>;
