// Central registry of domain adapters. Edge functions look up adapters by id.
import type { DomainAdapter, DomainId } from "../domain.ts";

const adapters = new Map<DomainId, DomainAdapter>();

export function registerDomain(adapter: DomainAdapter): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`Domain already registered: ${adapter.id}`);
  }
  adapters.set(adapter.id, adapter);
}

export function getDomain(id: DomainId): DomainAdapter {
  const a = adapters.get(id);
  if (!a) throw new Error(`Unknown domain: ${id}`);
  return a;
}

export function tryGetDomain(id: DomainId): DomainAdapter | null {
  return adapters.get(id) ?? null;
}

export function listDomains(): DomainAdapter[] {
  return Array.from(adapters.values());
}

export function clearDomainsForTest(): void {
  adapters.clear();
}
