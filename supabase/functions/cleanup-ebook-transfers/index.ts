import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// Deploy with JWT verification off; the scheduler uses a dedicated secret.
// SUPABASE_SERVICE_ROLE_KEY is an Edge Function secret, never a browser value.
Deno.serve(async (request: Request) => {
  const secret = Deno.env.get("EBOOK_CLEANUP_SECRET");
  if (!secret || request.headers.get("x-cleanup-secret") !== secret) return new Response("Unauthorized", { status: 401 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) }
  });
  try {
    const { data, error } = await client.rpc("reader_ebook_cleanup_candidates");
    if (error) throw error;
    if (data?.length) {
      const result = await client.storage.from("ebook-transfers").remove(data.map((row: { object_path: string }) => row.object_path));
      if (result.error) throw result.error;
      const ids = data.map((row: { transfer_id: string | null }) => row.transfer_id).filter(Boolean);
      if (ids.length) {
        const result = await client.from("reader_ebook_transfers").delete().in("id", ids);
        if (result.error) throw result.error;
      }
    }
    return Response.json({ removed: data?.length || 0 });
  } catch (_) { return Response.json({ error: "Cleanup failed; records retained for retry" }, { status: 503 }); }
});
