/**
 * The only platform global core/ uses: the WHATWG URL parser (identical in Node, browsers and edge runtimes).
 * Declared narrowly instead of pulling in Node or DOM types, so any real I/O API still fails to compile.
 */
declare class URL {
  constructor(input: string, base?: string);
  readonly hostname: string;
}
