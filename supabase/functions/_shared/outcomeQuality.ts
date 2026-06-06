// Detect outcome labels that are positional placeholders rather than real,
// named entities. The DISCOVERY_SYSTEM prompts already instruct models to
// avoid these, but multiple code paths (LLM discovery, sub-question
// templates, structured-data syncs) write into event_outcomes — so the rule
// has to be enforced at the persistence boundary as well.
//
// Examples this MUST reject:
//   "Player with lowest round"
//   "Tied lowest round"
//   "No complete round / event not completed"
//   "Driver 1", "Team A", "Candidate B", "Nominee A"
//   "Field", "Other", "Remaining"
//   "Option A", "Outcome 2"
//
// Examples this MUST keep:
//   "Yes", "No"                          (binary sub-questions)
//   "Liverpool win", "Draw", "Manchester City win"
//   "Max Verstappen", "Scottie Scheffler"
//   "Trump", "Harris"
//   any plain proper noun

const PLACEHOLDER_PATTERNS: RegExp[] = [
  // "Player A", "Driver 1", "Team B", "Candidate C", "Nominee A", "Horse 2"
  /^(player|driver|team|candidate|nominee|competitor|contestant|horse|rider|fighter|athlete|entrant|side|name)\s+[a-z0-9]{1,3}$/i,
  // "Option A", "Outcome 1", "Choice B"
  /^(option|outcome|choice|pick|selection)\s+[a-z0-9]{1,3}$/i,
  // "Player with lowest round", "Competitor with best time"
  /^(player|competitor|contestant|driver|rider|horse|team|candidate|entrant|athlete|side)\s+with\s+/i,
  // "Tied lowest round", "Tied for first"
  /^tied\b/i,
  // "Lowest score", "Highest finish", "Best time", "Worst placing"
  /^(lowest|highest|best|worst|fastest|slowest|first|last)\s+(score|round|time|finish|placing|position|result|lap)\b/i,
  // "No complete round", "No winner", "No finisher", "Event not completed"
  /^no\s+(complete|winner|result|finisher|finish|outcome|score)\b/i,
  /\bnot\s+completed?\b/i,
  // Bare field/other/remaining (also caught by the UI field-share row, but
  // we don't want them showing up as forecast outcomes either)
  /^(field|other|the field|the rest|remaining|other outcomes?|other team)$/i,
  // Bare positional words
  /^(winner|runner[- ]up|champion|home|away|either|none|tbd|tba|n\/a)$/i,
];

export function isPlaceholderLabel(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 120) return false; // very long labels are clearly not the placeholders we're worried about
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  return false;
}

/**
 * Return true if the outcome set contains ANY placeholder label. Used to
 * skip whole events at the discovery boundary — even one placeholder is
 * enough to make the forecast meaningless.
 */
export function hasPlaceholderOutcomes(labels: string[]): boolean {
  return labels.some(isPlaceholderLabel);
}
