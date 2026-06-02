import { useEffect, useState } from "react";

export type WireStage =
  | "rate_limit"
  | "pre_filter"
  | "moderation"
  | "research"
  | "models"
  | "consensus";

interface StageConfig {
  label?: string;
  rotation?: { labels: string[]; intervalMs: number };
}

const STAGE_MAP: Record<WireStage, StageConfig> = {
  rate_limit: { label: "Checking your question" },
  pre_filter: { label: "Reading your question" },
  moderation: { label: "Identifying the event" },
  research: { label: "Pulling real-time data" },
  models: {
    rotation: {
      labels: [
        "Consulting expert sources",
        "Weighing the evidence",
        "Cross-referencing forecasts",
        "Synthesising the picture",
      ],
      intervalMs: 1600,
    },
  },
  consensus: { label: "Calibrating confidence" },
};

export function useLoadingStages(currentStage: WireStage | null): string {
  const [rotationIdx, setRotationIdx] = useState(0);

  useEffect(() => {
    setRotationIdx(0);
    if (!currentStage) return;
    const cfg = STAGE_MAP[currentStage];
    if (!cfg.rotation) return;
    const { labels, intervalMs } = cfg.rotation;
    const id = setInterval(() => {
      setRotationIdx((i) => (i + 1) % labels.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [currentStage]);

  if (!currentStage) return "Reading your question";
  const cfg = STAGE_MAP[currentStage];
  if (cfg.label) return cfg.label;
  if (cfg.rotation) return cfg.rotation.labels[rotationIdx];
  return "";
}
