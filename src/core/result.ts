/** Tiny Result type so network/hardware failures are values, not exceptions. */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E = Error>(error: E): Result<never, E> => ({ ok: false, error });

export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return Ok(await fn());
  } catch (e) {
    return Err(toError(e));
  }
}
