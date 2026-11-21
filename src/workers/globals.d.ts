declare module '*.onnx?url' {
  const url: string;
  export default url;
}

/** Size in bytes of the bundled Maia model, injected by vite.config.ts. */
declare const __MAIA_MODEL_BYTES__: number;

/** Path (relative to the site root) of Stockfish's worker script, set in vite.config.ts. */
declare const __STOCKFISH_SCRIPT__: string;
