// Thin Supabase client factory for edge functions. Always uses service-role
// (writes bypass RLS — edge functions are the trusted backend).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (deno) return deno.env.get(name);
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

export function getServiceClient(): SupabaseClient {
  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
