// Client-side keyword classifier mapping event title → sub-category within a domain.
// No schema change, no LLM call. When data depth justifies it, this moves
// server-side to discovery time.

import type { DomainId } from "./types";

interface Rule {
  name: string;
  keywords: RegExp[];
}

const RULES: Record<DomainId, Rule[]> = {
  sport: [
    { name: "F1", keywords: [/\b(f1|formula\s*1|grand prix|monaco|silverstone|spa|monza)\b/i] },
    { name: "Tennis", keywords: [/\b(tennis|wimbledon|roland garros|french open|us open|atp|wta|alcaraz|sinner|djokovic|nadal)\b/i] },
    { name: "Football", keywords: [/\b(football|premier league|champions league|fifa|uefa|epl|world cup|chelsea|arsenal|liverpool|man city|barcelona|real madrid)\b/i] },
    { name: "Golf", keywords: [/\b(golf|pga|masters|us open golf|the open|ryder cup|liv golf|mcilroy|scottie|rory)\b/i] },
    { name: "Athletics", keywords: [/\b(athletics|diamond league|100m|1500m|marathon|sprint|ingebrigtsen|lyles)\b/i] },
  ],
  politics: [
    { name: "Elections", keywords: [/\b(election|primary|vote|ballot|referendum|electoral)\b/i] },
    { name: "Leadership", keywords: [/\b(leader|leadership|prime minister|president|chancellor|speaker)\b/i] },
    { name: "Polls", keywords: [/\b(poll|polling|approval|favourable)\b/i] },
  ],
  markets: [
    { name: "Central banks", keywords: [/\b(fed|fomc|federal reserve|ecb|bank of england|boe|boj|central bank|interest rate|rate decision)\b/i] },
    { name: "Earnings", keywords: [/\b(earnings|quarterly results|q[1-4]|eps|revenue beat)\b/i] },
    { name: "Macro prints", keywords: [/\b(cpi|inflation|nfp|nonfarm|gdp|retail sales|jobless claims|ppi|pmi|consumer sentiment)\b/i] },
  ],
  entertainment: [
    { name: "Awards", keywords: [/\b(oscars|emmys|grammys|baftas|globes|awards?|ceremony)\b/i] },
    { name: "Releases", keywords: [/\b(release|premiere|opening|opening weekend|box office|debut|launch)\b/i] },
    { name: "Finales", keywords: [/\b(finale|final episode|season finale|series finale|grand finale)\b/i] },
  ],
};

export function classifyEvent(title: string, domain: DomainId): string {
  const rules = RULES[domain];
  if (!rules) return "Other";
  for (const rule of rules) {
    if (rule.keywords.some((kw) => kw.test(title))) return rule.name;
  }
  return "Other";
}

export function getChipsForDomain(domain: DomainId): string[] {
  const subcats = (RULES[domain] ?? []).map((r) => r.name);
  return ["All", ...subcats, "Other"];
}
