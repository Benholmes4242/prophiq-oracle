import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CalibrationHeadline {
  n_resolved: number;
  avg_calibration_error_pp: number | null;
  computed_at: string;
}

/**
 * Reads the global calibration headline stats from get_calibration_headline().
 * Returns null when there are no resolved predictions yet (e.g., fresh deploy).
 * The hook itself never throws; consumer should guard for `data == null`.
 */
export function useCalibrationHeadline() {
  return useQuery({
    queryKey: ["calibration", "headline"],
    queryFn: async (): Promise<CalibrationHeadline | null> => {
      const { data, error } = await supabase.rpc("get_calibration_headline");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row.n_resolved !== "number") return null;
      if (row.n_resolved === 0) return null;
      return {
        n_resolved: row.n_resolved,
        avg_calibration_error_pp:
          typeof row.avg_calibration_error_pp === "number"
            ? row.avg_calibration_error_pp
            : null,
        computed_at: row.computed_at,
      };
    },
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
