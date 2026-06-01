// Aggregate import + registration entry point. Edge functions should import
// this once at boot to populate the registry.

import { registerDomain, clearDomainsForTest } from "./registry.ts";
import { sportAdapter } from "./sport.ts";
import { politicsAdapter } from "./politics.ts";
import { marketsAdapter } from "./markets.ts";
import { entertainmentAdapter } from "./entertainment.ts";

export function registerAllDomains(): void {
  clearDomainsForTest();
  registerDomain(sportAdapter);
  registerDomain(politicsAdapter);
  registerDomain(marketsAdapter);
  registerDomain(entertainmentAdapter);
}

export { sportAdapter, politicsAdapter, marketsAdapter, entertainmentAdapter };
