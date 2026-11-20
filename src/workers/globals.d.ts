declare module '*.onnx?url' {
  const url: string;
  export default url;
}

/** Size in bytes of the bundled Maia model, injected by vite.config.ts. */
declare const __MAIA_MODEL_BYTES__: number;
