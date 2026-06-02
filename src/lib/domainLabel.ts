// Single source of truth for domain display names.
// TODO: expand here if/when the taxonomy grows beyond the current four domains.
const DOMAIN_LABELS: Record<string, string> = {
  sport: "Sport",
  politics: "Politics",
  markets: "Markets",
  entertainment: "Entertainment",
};

export function domainLabel(domain?: string | null): string {
  if (!domain) return "Other";
  return DOMAIN_LABELS[domain.toLowerCase()] ?? "Other";
}
