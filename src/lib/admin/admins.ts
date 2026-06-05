import { supabase } from "@/lib/supabase";

export type AdminRoleName = "super_admin" | "admin" | "support" | "read_only";

export interface AdminRow {
  id: string;
  user_id: string;
  email: string;
  role: AdminRoleName;
  mfa_enforced: boolean;
  has_mfa_factor: boolean;
  created_at: string;
  created_by_email: string | null;
  revoked_at: string | null;
  notes: string | null;
}

export interface AdminSummaryRow {
  id: string;
  user_id: string;
  email: string;
  role: AdminRoleName;
  revoked_at: string | null;
}

export async function adminListAdmins(): Promise<AdminRow[]> {
  const { data, error } = await supabase.rpc("admin_list_admins");
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminRow[];
}

export async function adminGetAdmin(adminId: string): Promise<AdminSummaryRow | null> {
  const { data, error } = await supabase.rpc("admin_get_admin", { p_admin_id: adminId });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AdminSummaryRow[];
  return rows[0] ?? null;
}

export async function adminInviteAdmin(
  email: string,
  role: AdminRoleName,
  notes: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("admin_invite_admin", {
    p_email: email,
    p_role: role,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function adminRevokeAdmin(adminId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_revoke_admin", {
    p_admin_id: adminId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function adminChangeRole(adminId: string, newRole: AdminRoleName): Promise<void> {
  const { error } = await supabase.rpc("admin_change_role", {
    p_admin_id: adminId,
    p_new_role: newRole,
  });
  if (error) throw new Error(error.message);
}

export async function adminResetMfa(targetUserId: string): Promise<{ factors_cleared: number }> {
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated");

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-auth-actions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    },
    body: JSON.stringify({ action: "mfa_reset", target_user_id: targetUserId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `mfa_reset failed (${res.status})`);
  return { factors_cleared: Number(json?.factors_cleared ?? 0) };
}
