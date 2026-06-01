import { useQuery } from "@tanstack/react-query";
import { fetchCurrentPrediction, fetchEventBySlug } from "@/lib/queries";

export function useEventBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ["event", slug],
    queryFn: () => fetchEventBySlug(slug as string),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

export function useCurrentPrediction(
  eventId: string | undefined,
  mode: "prediction" | "odds" = "prediction",
) {
  return useQuery({
    queryKey: ["prediction", eventId, mode],
    queryFn: () => fetchCurrentPrediction(eventId as string, mode),
    enabled: Boolean(eventId),
    staleTime: 60_000,
  });
}
