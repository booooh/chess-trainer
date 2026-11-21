// Types for the `stockfish` package's Node entry point, used only by
// stockfishClient.real.test.ts. The app never imports 'stockfish' directly: the browser
// loads its worker script and .wasm by URL (see browserServices.ts).
declare module 'stockfish' {
  type NodeEngine = { listener?: (line: string) => void; processCommand: (command: string) => void };
  /** Starts an engine build, e.g. 'lite-single' for stockfish-19-lite-single.js. */
  export default function initEngine(flavor: string): NodeEngine;
}
