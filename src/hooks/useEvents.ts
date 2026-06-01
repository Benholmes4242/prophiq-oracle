import { useQuery } from "@tanstack/react-query";
import {
  fetchEvents,
  fetchDomainSummaries,
  fetchRecentPicks,
  fetchHomepagePicks,
  fetchScoredYesterday,
  type EventsFilter,
} from "@/lib/queries";

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

export function useHomepagePicks() {
  return useQuery({
    queryKey: ["homepage-picks"],
    queryFn: fetchHomepagePicks,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useScoredYesterday(limit = 6) {
  return useQuery({
    queryKey: ["scored-yesterday", limit],
    queryFn: () => fetchScoredYesterday(limit),
    staleTime: 5 * 60_000,
  });
}
