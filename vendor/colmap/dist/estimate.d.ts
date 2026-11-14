import type { Features, ImageInput, PairMatches, Progress, Reconstruction } from "./types.ts";
/**
 * Default worker count: one per core but one, at most 6, and fewer on devices
 * with little memory (each SIFT worker holds a few hundred MB on large images).
 */
export declare function defaultWorkers(): number;
export interface ExtractOptions {
    /** Masks aligned with the images (0 = ignore), as COLMAP's `--ImageReader.mask_path`. */
    masks?: (Blob | null | undefined)[];
    /** Parallel workers (default: `defaultWorkers()`). */
    workers?: number;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
}
/** COLMAP SIFT (CPU defaults, as `colmap feature_extractor`) on every image. */
export declare function extractFeatures(images: ImageInput[], options?: ExtractOptions): Promise<Features[]>;
export interface MapOptions {
    /** Seed for every RANSAC and the mapper (default 0): the same input gives the same cameras. */
    seed?: number;
    /** COLMAP's log lines (verification, calibration and mapper stages). */
    onLog?: (line: string) => void;
    signal?: AbortSignal;
}
/**
 * Geometric verification of the raw matches, view-graph calibration and the
 * global mapper (`colmap geometric_verifier` + `view_graph_calibrator` +
 * `global_mapper`). All images share one SIMPLE_PINHOLE camera, so they must
 * have the same size.
 */
export declare function reconstruct(names: string[], features: Features[], matches: PairMatches[], options?: MapOptions): Promise<Reconstruction>;
export interface EstimateOptions {
    /** Image pairs to match (default: all pairs; see `sequentialPairs` for video frames). */
    pairs?: [number, number][];
    masks?: (Blob | null | undefined)[];
    workers?: number;
    seed?: number;
    onProgress?: (p: Progress) => void;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
}
export interface EstimateResult {
    reconstruction: Reconstruction;
    features: Features[];
    /** Raw matches (before geometric verification). */
    matches: PairMatches[];
    /** Milliseconds per stage. */
    timings: {
        features: number;
        matching: number;
        mapping: number;
    };
}
/** Cameras and sparse points of a set of images, COLMAP-style, in the browser. */
export declare function estimatePoses(images: ImageInput[], options?: EstimateOptions): Promise<EstimateResult>;
