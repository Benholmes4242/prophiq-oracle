import { useQuery } from "@tanstack/react-query";
import {
  fetchEvents,
  fetchEventsWithPredictions,
  fetchDomainSummaries,
  fetchRecentPicks,
  fetchHomepagePicks,
  fetchScoredYesterday,
  fetchScoredRecent,
  fetchReceiptsStats,
  fetchRecentResolved,
  fetchNotableCalls,
  type EventsFilter,
} from "@/lib/queries";
import type { DomainId } from "@/lib/types";

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

export function useDomainEvents(domain: DomainId) {
  return useQuery({
    queryKey: ["domain-events", domain],
    queryFn: () =>
      fetchEventsWithPredictions({
        domain,
        status: "scheduled",
        order: "starts_at_asc",
        limit: 50,
      }),
    staleTime: 5 * 60_000,
  });
}

export function useDomainResolvedEvents(domain: DomainId, limit = 5) {
  return useQuery({
    queryKey: ["domain-resolved", domain, limit],
    queryFn: () =>
      fetchScoredRecent({ domain, limit, sinceMs: 7 * 24 * 60 * 60 * 1000 }),
    staleTime: 5 * 60_000,
  });
}

export function useReceiptsStats() {
  return useQuery({
    queryKey: ["receipts-stats"],
    queryFn: fetchReceiptsStats,
    staleTime: 5 * 60_000,
  });
}

export function useRecentResolved(limit = 10) {
  return useQuery({
    queryKey: ["recent-resolved", limit],
    queryFn: () => fetchRecentResolved(limit),
    staleTime: 5 * 60_000,
  });
}

export function useNotableCalls() {
  return useQuery({
    queryKey: ["notable-calls"],
    queryFn: fetchNotableCalls,
    staleTime: 5 * 60_000,
  });
}
