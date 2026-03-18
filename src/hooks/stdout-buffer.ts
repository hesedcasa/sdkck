/** Shared capture state between the init (capture) and finally (filter+flush) hooks. */
export const stdoutBuffer: {
  chunks: string[]
  originalWrite: null | typeof process.stdout.write
} = {
  chunks: [],
  originalWrite: null,
}
