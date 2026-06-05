import { supabase } from "@/lib/supabase";

export interface AuditRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  admin_email: string;
  admin_role: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  total_count: number;
}

export interface AuditListParams {
  adminUserId?: string | null;
  action?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export async function adminListAudit(
  p: AuditListParams,
): Promise<{ rows: AuditRow[]; total: number }> {
  const { data, error } = await supabase.rpc("admin_list_audit", {
    p_admin_user_id: p.adminUserId ?? null,
    p_action: p.action ?? null,
    p_target_type: p.targetType ?? null,
    p_target_id: p.targetId ?? null,
    p_search: p.search ?? null,
    p_from: p.from ?? null,
    p_to: p.to ?? null,
    p_limit: p.limit ?? 50,
    p_offset: p.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AuditRow[];
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 };
}

export async function adminDistinctAuditActions(): Promise<string[]> {
  const { data, error } = await supabase.rpc("admin_distinct_audit_actions");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { action: string }[]).map((r) => r.action);
}

export function auditRowsToCsv(rows: AuditRow[]): string {
  const header = [
    "created_at",
    "action",
    "target_type",
    "target_id",
    "admin_email",
    "admin_role",
    "metadata",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.created_at,
      r.action,
      r.target_type,
      r.target_id ?? "",
      r.admin_email,
      r.admin_role,
      JSON.stringify(r.metadata ?? {}),
    ].map((v) => {
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    });
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
