import { useQuery } from "@tanstack/react-query";
import { fetchEvents, fetchDomainSummaries, fetchRecentPicks, type EventsFilter } from "@/lib/queries";

export function useEvents(filter: EventsFilter = {}) {
  return useQuery({
    queryKey: ["events", filter],
    queryFn: () => fetchEvents(filter),
    staleTime: 60_000,
  });
}

export function useDomainSummaries() {
  return useQuery({
    queryKey: ["domain-summaries"],
    queryFn: fetchDomainSummaries,
    staleTime: 5 * 60_000,
  });
}

export function useRecentPicks(limit = 6) {
  return useQuery({
    queryKey: ["recent-picks", limit],
    queryFn: () => fetchRecentPicks(limit),
    staleTime: 60_000,
  });
}
