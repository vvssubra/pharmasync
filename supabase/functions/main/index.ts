// supabase/functions/main/index.ts
// Router entrypoint for the SELF-HOSTED Supabase Edge Runtime (the functions
// container starts with: edge-runtime start --main-service /home/deno/functions/main).
// Adapted from the official supabase/supabase docker/volumes/functions/main
// router; checked in here so mounting this repo's supabase/functions directory
// over /home/deno/functions is self-contained.
//
// Not used by the hosted Supabase platform — supabase functions deploy ignores it.

console.log("main function started");

// Generous timeout: local CPU LLM calls can take a minute or more.
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;
const MEMORY_LIMIT_MB = 256;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const serviceName = url.pathname.split("/")[1];

  if (!serviceName) {
    return new Response(
      JSON.stringify({ error: "missing function name in request" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const servicePath = `/home/deno/functions/${serviceName}`;

  const envVarsObj = Deno.env.toObject();
  const envVars = Object.keys(envVarsObj).map((key) => [key, envVarsObj[key]]);

  try {
    // deno-lint-ignore no-explicit-any
    const worker = await (globalThis as any).EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: MEMORY_LIMIT_MB,
      workerTimeoutMs: WORKER_TIMEOUT_MS,
      noModuleCache: false,
      importMapPath: null,
      envVars,
    });
    return await worker.fetch(req);
  } catch (e) {
    console.error(`worker error for ${serviceName}:`, e);
    return new Response(
      JSON.stringify({ error: "Function failed to start", detail: String(e).slice(0, 200) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
