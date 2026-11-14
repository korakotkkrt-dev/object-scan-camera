/** Every pair of `n` images (n·(n−1)/2 pairs). */
export declare function exhaustivePairs(n: number): [number, number][];
/**
 * Pairs for an ordered sequence (video frames): each image with the next
 * `window` ones, plus longer jumps (`jumps`, default 16, 32, 64) that tie
 * distant parts together. `loop`: the sequence is a closed orbit, so the end
 * is matched with the start (offsets up to n/2 in both directions).
 */
export declare function sequentialPairs(n: number, { window, jumps, loop }?: {
    window?: number;
    jumps?: number[];
    loop?: boolean;
}): [number, number][];
