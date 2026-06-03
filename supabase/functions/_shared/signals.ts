// Deterministic signal extraction from LLM reasons text. Each domain has a
// controlled vocabulary of high-level signal categories, mapped to keyword
// patterns. We scan model_results.details.*.reasons and return the union
// of signal categories detected across all models. No LLM call.

import type { ModelRanking } from "./consensusEngine.ts";
import type { DomainId } from "./domain.ts";

interface SignalPattern {
  category: string;
  patterns: RegExp[];
}

const SPORT_SIGNALS: SignalPattern[] = [
  { category: "recent_form",            patterns: [/\bform\b/i, /\blast \d+\b/i, /\brecent\b/i, /\bstreak\b/i, /\bunbeaten\b/i, /\bwinless\b/i] },
  { category: "head_to_head",           patterns: [/\bh2h\b/i, /\bhead[\s-]to[\s-]head\b/i, /\bvs\.? history\b/i, /\bmeeting\b/i, /\bprevious meetings?\b/i] },
  { category: "injuries",               patterns: [/\binjur(?:y|ies|ed)\b/i, /\bsuspended?\b/i, /\babsent\b/i, /\bdoubt(?:ful)?\b/i, /\bmissing\b/i, /\bsidelined?\b/i] },
  { category: "venue_factors",          patterns: [/\bhome\b/i, /\baway\b/i, /\bvenue\b/i, /\bstadium\b/i, /\bground\b/i, /\bsurface\b/i, /\btrack\b/i] },
  { category: "weather",                patterns: [/\bweather\b/i, /\brain\b/i, /\bwind\b/i, /\btemperature\b/i, /\bhumid/i, /\bdry\b/i, /\bwet\b/i] },
  { category: "betting_market_signals", patterns: [/\bodds\b/i, /\bmarket\b/i, /\bfavou?rite\b/i, /\bunderdog\b/i, /\bimplied\b/i] },
  { category: "lineup_or_tactics",      patterns: [/\blineup\b/i, /\bformation\b/i, /\btactics?\b/i, /\bstrateg/i, /\bcoach\b/i, /\bmanager\b/i] },
];

const POLITICS_SIGNALS: SignalPattern[] = [
  { category: "polling",                patterns: [/\bpoll(?:s|ing)?\b/i, /\bsurvey/i, /\bvoters?\b/i, /\bsample\b/i, /\baverage\b/i] },
  { category: "recent_statements",      patterns: [/\bstatement\b/i, /\bspeech\b/i, /\bsaid\b/i, /\banno?unce/i, /\bdebate\b/i] },
  { category: "prediction_market",      patterns: [/\bpolymarket\b/i, /\bkalshi\b/i, /\bpredictit\b/i, /\bbettin/i, /\bcontract\b/i, /\bimplied\b/i] },
  { category: "expert_commentary",      patterns: [/\banalyst/i, /\bcommentator/i, /\bexpert/i, /\bobserver/i, /\bpundit/i] },
  { category: "endorsements",           patterns: [/\bendorse/i, /\bsupport\b/i, /\bbacking\b/i, /\balliance\b/i] },
  { category: "incumbent_advantage",    patterns: [/\bincumb/i, /\bsitting\b/i, /\bcurrent (?:president|prime minister|holder)/i] },
];

const MARKETS_SIGNALS: SignalPattern[] = [
  { category: "economic_data",          patterns: [/\bdata\b/i, /\bprint\b/i, /\binflation\b/i, /\bcpi\b/i, /\bpce\b/i, /\bpmi\b/i, /\bjobs\b/i, /\bpayrolls?\b/i, /\bgdp\b/i, /\bnfp\b/i] },
  { category: "central_bank",           patterns: [/\bfed\b/i, /\bfomc\b/i, /\becb\b/i, /\bboe\b/i, /\bboj\b/i, /\bcentral bank\b/i, /\brate\b/i, /\bdove?/i, /\bhawk?/i] },
  { category: "market_positioning",     patterns: [/\bpositioning\b/i, /\bfutures?\b/i, /\bswap/i, /\bois\b/i, /\bbasis\b/i, /\bspread\b/i, /\bimplied\b/i] },
  { category: "analyst_consensus",      patterns: [/\bconsensus\b/i, /\bestimate/i, /\bforecast/i, /\bsurvey/i, /\bsell[\s-]side\b/i] },
  { category: "technical_signals",      patterns: [/\btechnical/i, /\btrend/i, /\bbreakout/i, /\bsupport\b/i, /\bresistance\b/i, /\bmoving average/i] },
  { category: "geopolitical",           patterns: [/\bgeopolit/i, /\bsanction/i, /\bconflict/i, /\bwar\b/i, /\btrade\b/i, /\btariff/i] },
];

const ENTERTAINMENT_SIGNALS: SignalPattern[] = [
  { category: "guild_awards",           patterns: [/\bsag\b/i, /\bdga\b/i, /\bpga\b/i, /\bwga\b/i, /\bcritic'?s? choice\b/i, /\bgolden globe/i, /\bbafta/i, /\bgrammy/i] },
  { category: "critical_reception",     patterns: [/\bcritic/i, /\breview/i, /\brotten tomato/i, /\bmetacritic/i, /\baudience score/i] },
  { category: "betting_market_signals", patterns: [/\bodds\b/i, /\bmarket\b/i, /\bfavou?rite\b/i, /\bunderdog\b/i] },
  { category: "festival_signals",       patterns: [/\bcannes\b/i, /\bvenice\b/i, /\btoronto\b/i, /\bsundance\b/i, /\btelluride\b/i, /\bberlinale\b/i, /\bfestival\b/i] },
  { category: "audience_momentum",      patterns: [/\bbox office\b/i, /\bopening/i, /\bstream/i, /\bviewing\b/i, /\bratings\b/i, /\bdebut/i] },
  { category: "industry_buzz",          patterns: [/\bvariety\b/i, /\bdeadline\b/i, /\bhollywood/i, /\bbuzz\b/i, /\bmomentum\b/i, /\bnarrative\b/i] },
];

const DOMAIN_VOCABULARY: Record<DomainId, SignalPattern[]> = {
  sport: SPORT_SIGNALS,
  politics: POLITICS_SIGNALS,
  markets: MARKETS_SIGNALS,
  entertainment: ENTERTAINMENT_SIGNALS,
};

/**
 * Scan model reasoning across all LLMs and return the union of high-level
 * signal categories detected. Deterministic, no LLM call.
 */
export function extractSignalsUsed(
  domain: DomainId,
  modelResults: ModelRanking[],
): string[] {
  const vocab = DOMAIN_VOCABULARY[domain];
  if (!vocab) return [];

  const allReasons: string[] = [];
  for (const model of modelResults) {
    if (model.error) continue;
    if (!model.details) continue;
    for (const detail of Object.values(model.details)) {
      if (Array.isArray(detail.reasons)) {
        allReasons.push(...detail.reasons);
      }
    }
    if (typeof model.rationale === "string") {
      allReasons.push(model.rationale);
    }
  }
  const corpus = allReasons.join("\n").toLowerCase();
  if (!corpus.trim()) return [];

  const detected = new Set<string>();
  for (const { category, patterns } of vocab) {
    if (patterns.some((p) => p.test(corpus))) {
      detected.add(category);
    }
  }
  return Array.from(detected).sort();
}

/** Rough estimate of tokens for a prompt, for cost analytics. ~4 chars/token. */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
