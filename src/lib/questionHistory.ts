// localStorage-backed question history. No server-side persistence.

export type QuestionHistoryEntry = {
  id: string;
  question: string;
  submittedAt: string;
  eventSlug?: string;
  eventDomain?: string;
};

const KEY = "prophiq:question-history";
const MAX = 50;

function safeWindow(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function getHistory(): QuestionHistoryEntry[] {
  if (!safeWindow()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as QuestionHistoryEntry[];
  } catch {
    return [];
  }
}

export function addToHistory(
  entry: Omit<QuestionHistoryEntry, "id" | "submittedAt">,
): QuestionHistoryEntry {
  const next: QuestionHistoryEntry = {
    ...entry,
    id:
      safeWindow() && typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    submittedAt: new Date().toISOString(),
  };
  if (!safeWindow()) return next;
  const list = getHistory();
  list.unshift(next);
  if (list.length > MAX) list.length = MAX;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota / disabled — ignore */
  }
  return next;
}

export function updateHistory(
  id: string,
  patch: Partial<QuestionHistoryEntry>,
): void {
  if (!safeWindow()) return;
  const list = getHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function clearHistory(): void {
  if (!safeWindow()) return;
  localStorage.removeItem(KEY);
}
