import { supabase } from "@/lib/supabase";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface AdminNotification {
  id: string;
  severity: NotificationSeverity;
  category: string;
  title: string;
  body: string | null;
  source: string;
  target_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  is_read: boolean;
  unread_count: number;
}

export async function adminListNotifications(
  limit = 30,
  unreadOnly = false,
): Promise<AdminNotification[]> {
  const { data, error } = await supabase.rpc("admin_list_notifications", {
    p_limit: limit,
    p_unread_only: unreadOnly,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminNotification[];
}

export async function adminMarkNotificationsRead(
  notificationId?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("admin_mark_notifications_read", {
    p_notification_id: notificationId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}
