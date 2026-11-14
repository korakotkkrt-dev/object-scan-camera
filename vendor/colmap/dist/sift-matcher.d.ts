import type { PairMatches } from "./types.ts";
export interface SiftMatchOptions {
    /** Lowe's ratio test (COLMAP default 0.8). */
    maxRatio?: number;
    /** Maximum angle between descriptors, in radians (COLMAP default 0.7). */
    maxDistance?: number;
    /** Keep only mutual best matches (COLMAP default true). */
    crossCheck?: boolean;
    /** Pairs per GPU dispatch. */
    batch?: number;
    onProgress?: (done: number, total: number) => void;
}
export declare class SiftMatcher {
    private device;
    private pipeline;
    private ownsDevice;
    private constructor();
    /**
     * `device`: an existing WebGPU device to share (otherwise one is requested).
     * `packedDot: false` forces the shader path for GPUs without dot4U8Packed.
     */
    static create({ device, packedDot, }?: {
        device?: GPUDevice;
        packedDot?: boolean;
    }): Promise<SiftMatcher>;
    /** Matches the requested pairs of images. `descriptors`: 128 bytes per keypoint, per image. */
    match(descriptors: Uint8Array[], pairs: [number, number][], options?: SiftMatchOptions): Promise<PairMatches[]>;
    /** Releases the GPU device, unless it was passed to `create`. */
    destroy(): void;
}
