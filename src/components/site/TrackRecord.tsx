import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type TrackRecordRow = {
  accuracy_pct: number;
  total_calls: number;
  window_days: number;
};

export function TrackRecord({ stagger }: { stagger?: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["homepage-track-record"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_homepage_track_record");
      if (error) throw error;
      return (data?.[0] ?? null) as TrackRecordRow | null;
    },
    staleTime: 15 * 60 * 1000,
  });

  if (isLoading || !data || !data.total_calls || data.total_calls === 0) {
    return null;
  }

  return (
    <div
      className="entry-animate mt-3 px-4"
      data-stagger={stagger}
    >
      <div className="mb-1.5 flex items-center gap-2.5">
        <div
          className="font-mono text-[9.5px] font-semibold uppercase"
          style={{ letterSpacing: "0.22em", color: "var(--ink-3)" }}
        >
          Track Record
        </div>
        <div className="h-px flex-1" style={{ background: "var(--line)" }} />
      </div>
      <div
        className="font-body text-center text-[13px]"
        style={{ color: "var(--ink-2)", fontFeatureSettings: "'tnum'" }}
      >
        <span style={{ color: "var(--amber)", fontWeight: 600 }}>
          {Number(data.accuracy_pct)}% accurate
        </span>
        {" · "}
        {data.total_calls} {data.total_calls === 1 ? "call" : "calls"}
        {" · "}
        last {data.window_days} days
      </div>
    </div>
  );
}
