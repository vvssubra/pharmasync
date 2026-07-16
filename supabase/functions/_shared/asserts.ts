// Minimal assert helpers over Deno's built-in node:assert — keeps the test
// suites runnable fully offline (no deno.land/jsr fetch at test time).
import { deepStrictEqual, ok, rejects } from "node:assert";

export function assertEquals<T>(actual: T, expected: T): void {
  deepStrictEqual(actual, expected);
}

export function assert(condition: unknown, message?: string): void {
  ok(condition, message);
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  // deno-lint-ignore no-explicit-any
  errorClass?: new (...args: any[]) => Error,
  msgIncludes?: string,
): Promise<void> {
  await rejects(fn, (err: unknown) => {
    if (errorClass && !(err instanceof errorClass)) return false;
    if (msgIncludes && !(err instanceof Error && err.message.includes(msgIncludes))) return false;
    return true;
  });
}
