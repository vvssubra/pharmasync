// The edge functions under supabase/functions/ run on Deno and import their
// dependencies by URL. Unit tests in src/test/ (and a role-list comment check in
// AiChatWidget) import shared logic across that runtime boundary, which drags
// those Deno files into the browser tsconfig graph — where a https:// specifier
// can never resolve under Node module resolution.
//
// `exclude` cannot fix this: tsconfig.app.json includes only "src", so these
// files arrive transitively via imports, and exclude does not filter those.
//
// An ambient `declare module` is matched on the exact specifier string before
// any resolution runs, so it cannot fail. Re-exporting from the installed npm
// package keeps context.ts fully typed rather than degrading it to `any`.
// Deno never reads this file.
//
// Only one URL specifier actually reaches the browser graph today
// (supabase/functions/ai-query/context.ts). The deno.land/x/zod and
// deno.land/std URLs live in function entrypoints and Deno-runner tests that
// nothing in src imports.
//
// WARNING: version-pinned. Bumping @supabase/supabase-js in an edge function
// reintroduces TS2307 — update the specifier below to match.
declare module "https://esm.sh/@supabase/supabase-js@2.46.0" {
  export type { SupabaseClient } from "@supabase/supabase-js";
}
