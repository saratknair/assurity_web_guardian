declare module "pixelmatch" {
  interface PixelmatchOptions {
    threshold?: number;
    includeAA?: boolean;
    alpha?: number;
    diffColor?: [number, number, number];
    diffMask?: boolean;
  }
  function pixelmatch(
    img1: Uint8Array | Buffer,
    img2: Uint8Array | Buffer,
    output: Uint8Array | Buffer | null,
    width: number,
    height: number,
    options?: PixelmatchOptions,
  ): number;
  export default pixelmatch;
}
