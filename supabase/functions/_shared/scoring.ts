// Score a prediction against the resolved outcome rankings. Produces the
// metrics persisted in prediction_accuracy.

export interface PredictedOutcome {
  outcome_id: string;
  rank: number;
}

export interface ActualOutcome {
  outcome_id: string;
  rank: number;
}

export interface PickResult {
  outcome_id: string;
  predicted_rank: number;
  actual_rank: number | null;
  delta: number | null;
}

export type AccuracyGrade = "excellent" | "good" | "mixed" | "poor";

export interface ScoringResult {
  pick_results: PickResult[];
  top_pick_correct: boolean;
  picks_in_top_3: number;
  picks_in_top_5: number;
  picks_in_top_10: number;
  best_pick_actual_rank: number | null;
  average_predicted_rank: number;
  average_actual_rank: number | null;
  accuracy_grade: AccuracyGrade;
}

export function scorePrediction(
  predicted: PredictedOutcome[],
  actual: ActualOutcome[],
): ScoringResult {
  if (predicted.length === 0) throw new Error("No predictions to score");

  const actualByOutcome = new Map(actual.map((a) => [a.outcome_id, a.rank]));

  const pick_results: PickResult[] = predicted.map((p) => {
    const actualRank = actualByOutcome.get(p.outcome_id) ?? null;
    return {
      outcome_id: p.outcome_id,
      predicted_rank: p.rank,
      actual_rank: actualRank,
      delta: actualRank === null ? null : actualRank - p.rank,
    };
  });

  const topPick = pick_results.find((p) => p.predicted_rank === 1) ?? pick_results[0];
  const top_pick_correct = topPick.actual_rank === 1;

  const inTop = (k: number) =>
    pick_results.filter((p) => p.actual_rank !== null && p.actual_rank <= k).length;

  const actualRanks = pick_results
    .map((p) => p.actual_rank)
    .filter((r): r is number => r !== null);

  const best_pick_actual_rank = actualRanks.length === 0 ? null : Math.min(...actualRanks);

  const average_predicted_rank = avg(pick_results.map((p) => p.predicted_rank));
  const average_actual_rank = actualRanks.length === 0 ? null : avg(actualRanks);

  return {
    pick_results,
    top_pick_correct,
    picks_in_top_3: inTop(3),
    picks_in_top_5: inTop(5),
    picks_in_top_10: inTop(10),
    best_pick_actual_rank,
    average_predicted_rank,
    average_actual_rank,
    accuracy_grade: gradeAccuracy(
      top_pick_correct,
      inTop(3),
      inTop(5),
      inTop(10),
    ),
  };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

function gradeAccuracy(
  topCorrect: boolean,
  picksInTop3: number,
  picksInTop5: number,
  picksInTop10: number,
): AccuracyGrade {
  if (topCorrect || picksInTop3 >= 3) return "excellent";
  if (picksInTop5 >= 3) return "good";
  if (picksInTop10 >= 2) return "mixed";
  return "poor";
}
