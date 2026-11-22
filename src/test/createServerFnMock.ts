// A Vitest stand-in for `@tanstack/react-start`'s `createServerFn`, so a route's
// server functions can be tested without the Start runtime (after LandonSchropp's
// builder mock in https://github.com/TanStack/router/discussions/2701).
//
// The builder chains like the real one; `.handler(fn)` returns a plain async
// function with the server function's call signature, `({ data }) => result`,
// that runs the captured input validator and then the handler. So a test
// imports the exported server function and calls it exactly as client code
// does, with nothing in between: no RPC, no serialization, no middleware.
//
// Usage, before importing the route:
//
//   vi.mock('@tanstack/react-start', () => import('@/test/createServerFnMock'))

type Validator = (input: unknown) => unknown
type Handler = (ctx: { data: unknown }) => unknown

export function createServerFn() {
  let validator: Validator | undefined
  const builder = {
    middleware: () => builder,
    inputValidator: (fn: Validator) => {
      validator = fn
      return builder
    },
    handler: (handler: Handler) => async (opts?: { data?: unknown }) => {
      const input = opts?.data
      const data = validator ? validator(input) : input
      // Awaited so a validator's throw and the handler's both reject.
      return await handler({ data })
    },
  }
  return builder
}
