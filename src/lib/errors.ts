/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Supabase rejections (PostgrestError: RLS violations, check constraints,
 * trigger exceptions) are plain objects, not Error instances — an
 * `instanceof Error` check drops their message and hides the real cause.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
