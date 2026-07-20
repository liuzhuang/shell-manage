declare module 'shell-quote' {
  export function parse(command: string, env?: (key: string) => unknown): unknown[]
}
