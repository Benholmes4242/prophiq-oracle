import { supabase } from "@/lib/supabase";

export interface MfaState {
  required: boolean;
  enforcementStart: string | null;
  enforced: boolean; // role-required AND past enforcement date
  hasFactor: boolean;
  aal: "aal1" | "aal2" | null;
  nextAal: "aal1" | "aal2" | null;
}

export async function getMfaEnforcementStart(): Promise<string | null> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("value")
    .eq("key", "mfa_enforcement_start")
    .maybeSingle();
  if (error) return null;
  const v = (data?.value as unknown) ?? null;
  return typeof v === "string" ? v : null;
}

export async function getCurrentAal(): Promise<{
  current: "aal1" | "aal2" | null;
  next: "aal1" | "aal2" | null;
}> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    current: (data?.currentLevel as "aal1" | "aal2" | null) ?? null,
    next: (data?.nextLevel as "aal1" | "aal2" | null) ?? null,
  };
}

export async function listFactors(): Promise<{ totpVerified: boolean; factorId: string | null }> {
  const { data } = await supabase.auth.mfa.listFactors();
  const totp = data?.totp?.[0];
  return {
    totpVerified: !!totp && totp.status === "verified",
    factorId: totp?.id ?? null,
  };
}

export async function enrollTotp(): Promise<{ factorId: string; qr: string; secret: string }> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw new Error(error.message);
  return {
    factorId: data.id,
    qr: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr) throw new Error(chErr.message);
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: ch.id,
    code,
  });
  if (error) throw new Error(error.message);
}

export async function generateRecoveryCode(): Promise<string> {
  const { data, error } = await supabase.functions.invoke("admin-mfa-recovery", {
    body: { action: "generate" },
  });
  if (error) throw new Error(error.message);
  return (data as { recovery_code: string }).recovery_code;
}
