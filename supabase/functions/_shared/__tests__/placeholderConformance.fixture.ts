// Shared fixture for the placeholder-gate conformance tests.
//
// Each row asserts the expected verdict at TWO gates:
//   - displayPlaceholder     → public.is_placeholder_outcome_label (SQL) /
//                              isDisplayPlaceholder (edge) /
//                              isPlaceholderOutcomeLabel (frontend)
//   - persistencePlaceholder → isPlaceholderLabel (edge, broad)
//
// Invariant enforced by the test runner:
//   displayPlaceholder === true ⇒ persistencePlaceholder === true
// (Display gate is a subset of the persistence gate.)
//
// This file is imported by both the edge conformance test and the SQL
// parity query is hand-derived from it (db/tests/placeholder_gate_parity.sql).
// Keep them in sync when you add a row.

export interface PlaceholderFixtureRow {
  label: string;
  displayPlaceholder: boolean;
  persistencePlaceholder: boolean;
}

export const PLACEHOLDER_FIXTURE: readonly PlaceholderFixtureRow[] = [
  // --- buckets / placeholders: MUST trip both gates -----------------------
  { label: "Another PGA Tour player", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "various drivers", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "elite players", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Any other player", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Any other runner", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "The field", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "rest of the field", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "multiple players", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Player A wins", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Horse 2 wins", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Team A wins", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Team B", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Side 1", displayPlaceholder: true, persistencePlaceholder: true },
  { label: "Pair A", displayPlaceholder: true, persistencePlaceholder: true },

  // --- real names: MUST NOT trip either gate ------------------------------
  { label: "Sam Burns", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Ryan Fox", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Scottie Scheffler", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Max Verstappen", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Springfield", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Tommy Fleetwood", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Manchester United", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Team Penske", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Team Sky", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Arsenal", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Red Bull Racing", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "J.T. Poston", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Liverpool win", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Draw", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Yes", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "No", displayPlaceholder: false, persistencePlaceholder: false },
  { label: "Trump", displayPlaceholder: false, persistencePlaceholder: false },

  // --- persistence-only rejects: broad gate trips, display gate must NOT -
  { label: "Player with lowest round", displayPlaceholder: false, persistencePlaceholder: true },
  { label: "Tied for first", displayPlaceholder: false, persistencePlaceholder: true },
  { label: "No complete round", displayPlaceholder: false, persistencePlaceholder: true },
  { label: "Option A", displayPlaceholder: false, persistencePlaceholder: true },
  { label: "Outcome 2", displayPlaceholder: false, persistencePlaceholder: true },
  { label: "Winner", displayPlaceholder: false, persistencePlaceholder: true },
  { label: "TBD", displayPlaceholder: false, persistencePlaceholder: true },
];
