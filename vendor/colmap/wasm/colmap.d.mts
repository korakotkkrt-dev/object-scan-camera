export interface ColmapModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _cw_error(): number;
  _cw_extract(rgb: number, width: number, height: number): number;
  _cw_keypoints(): number;
  _cw_descriptors(): number;
  _cw_map_begin(width: number, height: number): number;
  _cw_map_image(name: number, keypoints: number, n: number): number;
  _cw_map_matches(a: number, b: number, matches: number, n: number): number;
  _cw_map_run(seed: number): number;
  _cw_res_camera(): number;
  _cw_res_poses(): number;
  _cw_res_num_points(): number;
  _cw_res_points(): number;
  _cw_res_tracks_size(): number;
  _cw_res_tracks(): number;
  _cw_map_end(): void;
  UTF8ToString(ptr: number): string;
  stringToNewUTF8(s: string): number;
}
export default function createModule(options?: {
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  locateFile?: (path: string, prefix: string) => string;
}): Promise<ColmapModule>;
