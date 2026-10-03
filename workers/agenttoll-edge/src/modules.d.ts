// Module shapes wrangler's bundler provides: `.wasm` imports are compiled modules, `.yaml`
// imports are text (rule in wrangler.toml).
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

declare module '*.yaml' {
  const text: string;
  export default text;
}
