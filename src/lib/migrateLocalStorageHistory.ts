// One-time migration: attaches legacy localStorage asked-history to the
// current authenticated user via UPDATE on the events table where the row
// is currently orphaned (submitted_by_user_id IS NULL).
//
// Safe to call multiple times - short-circuits once a flag is set.

import { supabase } from "./supabase";

const RECLAIM_FLAG_KEY = "prophiq_localstorage_reclaim_done_at";
const LEGACY_HISTORY_KEYS = [
  "prophiq_asked_history", // primary legacy key
  "asked_event_ids",       // older fallback
  "prophiq:questionHistory", // current questionHistory key (best effort)
];

interface LegacyHistoryItem {
  event_id?: string;
  id?: string;
  eventId?: string;
  slug?: string;
  asked_at?: string;
}

export async function reclaimLegacyAskedHistory(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(RECLAIM_FLAG_KEY)) return;

  try {
    const eventIds = new Set<string>();
    for (const key of LEGACY_HISTORY_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as LegacyHistoryItem[] | string[];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const id =
              typeof item === "string"
                ? item
                : (item.event_id ?? item.eventId ?? item.id);
            if (typeof id === "string" && id.length > 0) eventIds.add(id);
          }
        }
      } catch (e) {
        console.warn(`[reclaim] could not parse ${key}:`, e);
      }
    }

    if (eventIds.size === 0) {
      localStorage.setItem(RECLAIM_FLAG_KEY, new Date().toISOString());
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // session not ready; retry next mount

    const { error, count } = await supabase
      .from("events")
      .update({ submitted_by_user_id: user.id })
      .is("submitted_by_user_id", null)
      .in("id", Array.from(eventIds))
      .select("id", { count: "exact", head: true });

    if (error) {
      console.warn("[reclaim] update failed:", error.message);
      return; // don't set flag; retry next mount
    }

    console.info(
      `[reclaim] attached ${count ?? 0} legacy events to user ${user.id}`,
    );
    localStorage.setItem(RECLAIM_FLAG_KEY, new Date().toISOString());
  } catch (e) {
    console.warn("[reclaim] unexpected error:", e);
  }
}
