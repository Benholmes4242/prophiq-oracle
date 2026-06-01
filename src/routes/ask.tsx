import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { getBrowserFingerprint } from "@/hooks/useBrowserFingerprint";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask Prophiq — Live consensus forecast" },
      {
        name: "description",
        content:
          "Submit any future-event question and watch three AI models run a live consensus forecast end-to-end.",
      },
      { property: "og:title", content: "Ask Prophiq — Live consensus forecast" },
      {
        property: "og:description",
        content: "Submit a question and watch the consensus pipeline run live.",
      },
    ],
  }),
  component: AskPage,
});

type Mode = "prediction" | "odds";
type DomainHint = "unsure" | "sport" | "politics" | "markets" | "entertainment";

const STAGES = [
  { id: "rate_limit", label: "Checking rate limit" },
  { id: "pre_filter", label: "Pre-filtering question" },
  { id: "moderation", label: "Classifying & moderating" },
  { id: "research", label: "Gathering context" },
  { id: "models", label: "Running 3 LLMs" },
  { id: "consensus", label: "Computing consensus" },
  { id: "done", label: "Finalizing forecast" },
] as const;

type StageId = (typeof STAGES)[number]["id"];
type StageStatus = "pending" | "active" | "done" | "error";

interface StageState {
  status: StageStatus;
  message?: string;
}

const EXAMPLES = [
  "Who will win the next Champions League final?",
  "Will the Fed cut rates at the next FOMC meeting?",
  "Will the next Best Picture Oscar go to a non-English-language film?",
];

const MAX_LEN = 500;

function initialStages(): Record<StageId, StageState> {
  return Object.fromEntries(
    STAGES.map((s) => [s.id, { status: "pending" as StageStatus }]),
  ) as Record<StageId, StageState>;
}

function AskPage() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>("prediction");
  const [domainHint, setDomainHint] = useState<DomainHint>("unsure");
  const [streaming, setStreaming] = useState(false);
  const [stages, setStages] = useState<Record<StageId, StageState>>(initialStages);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ slug: string; domain: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const remaining = MAX_LEN - question.length;
  const canSubmit = question.trim().length > 0 && !streaming;

  const reset = useCallback(() => {
    setStages(initialStages());
    setFatalError(null);
    setSuccess(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      reset();
      setStreaming(true);

      const fingerprint = await getBrowserFingerprint();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-question`;
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anon}`,
            apikey: anon,
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            question: question.trim(),
            mode,
            suggested_domain: domainHint === "unsure" ? null : domainHint,
            fingerprint,
          }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          if (res.status === 429) {
            setFatalError(
              "You've hit the submission limit. Try again later (limit resets daily).",
            );
          } else {
            setFatalError(`Request failed (${res.status}). Please try again.`);
          }
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Mark first stage active immediately so the UI never sits blank.
        setStages((prev) => ({ ...prev, rate_limit: { status: "active" } }));

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = raw.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let evt: {
              stage: StageId;
              status: "start" | "progress" | "done" | "error";
              message?: string;
              data?: Record<string, unknown>;
            };
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }

            if (evt.status === "start") {
              setStages((prev) => ({ ...prev, [evt.stage]: { status: "active" } }));
            } else if (evt.status === "done") {
              setStages((prev) => {
                const next = { ...prev, [evt.stage]: { status: "done" as const } };
                // Advance the next stage visually so the user sees momentum.
                const order = STAGES.map((s) => s.id);
                const i = order.indexOf(evt.stage);
                if (i >= 0 && i < order.length - 1) {
                  const nxt = order[i + 1];
                  if (next[nxt].status === "pending")
                    next[nxt] = { status: "active" };
                }
                return next;
              });
              if (evt.stage === "done" && evt.data) {
                const slug = (evt.data as { slug?: string }).slug;
                const domain = (evt.data as { domain?: string }).domain;
                if (slug && domain) {
                  setSuccess({ slug, domain });
                  setTimeout(() => {
                    void navigate({
                      to: "/$domain/events/$slug",
                      params: { domain, slug },
                    });
                  }, 900);
                } else {
                  setFatalError("Forecast generated but couldn't navigate. Refresh to view.");
                }
              }
            } else if (evt.status === "error") {
              setStages((prev) => ({
                ...prev,
                [evt.stage]: { status: "error", message: evt.message },
              }));
              if (evt.stage === "moderation" || evt.stage === "pre_filter") {
                setFatalError(
                  "Your question can't be answered — try a more specific, public-event prediction question.",
                );
              } else if (evt.stage === "rate_limit") {
                setFatalError(
                  evt.message ??
                    "You've reached today's submission limit. Try again tomorrow.",
                );
              } else {
                setFatalError(
                  evt.message ??
                    "Something went wrong while generating the forecast. Please try again.",
                );
              }
              setStreaming(false);
              return;
            }
          }
        }
        setStreaming(false);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setFatalError("Network error — please try again.");
        }
        setStreaming(false);
      }
    },
    [canSubmit, question, mode, domainHint, navigate, reset],
  );

  const stageList = useMemo(
    () =>
      STAGES.map((s) => ({
        ...s,
        state: stages[s.id],
      })),
    [stages],
  );

  return (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
            <Sparkles className="h-3.5 w-3.5" /> Live consensus pipeline
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[var(--brand-ink)] sm:text-4xl">
            Ask Prophiq
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">
            Pose a question about a future public event. Three frontier models will research,
            forecast, and reach consensus — live, in front of you.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="mt-10 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <fieldset disabled={streaming} className="space-y-6">
            <div>
              <Label htmlFor="question" className="text-sm font-medium text-slate-800">
                Your question
              </Label>
              <Textarea
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, MAX_LEN))}
                placeholder="e.g. Will Manchester City win the Premier League this season?"
                className="mt-2 min-h-[110px] resize-none"
                required
                aria-describedby="question-hint"
              />
              <div
                id="question-hint"
                className="mt-1.5 flex items-center justify-between text-xs text-slate-500"
              >
                <span>Be specific. Public events only.</span>
                <span className={cn(remaining < 50 && "text-amber-600")}>
                  {remaining} characters left
                </span>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <Label className="text-sm font-medium text-slate-800">Mode</Label>
                <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {(["prediction", "odds"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm capitalize transition",
                        mode === m
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label
                  htmlFor="domain-hint"
                  className="text-sm font-medium text-slate-800"
                >
                  Topic (optional)
                </Label>
                <select
                  id="domain-hint"
                  value={domainHint}
                  onChange={(e) => setDomainHint(e.target.value as DomainHint)}
                  className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="unsure">Not sure / let Prophiq decide</option>
                  <option value="sport">Sport</option>
                  <option value="politics">Politics</option>
                  <option value="markets">Markets</option>
                  <option value="entertainment">Entertainment</option>
                </select>
              </div>
            </div>

            <Button
              type="submit"
              disabled={!canSubmit}
              className="w-full sm:w-auto"
              size="lg"
            >
              {streaming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                "Run consensus forecast"
              )}
            </Button>
          </fieldset>
        </form>

        {!streaming && !fatalError && !success && (
          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Try one of these
            </p>
            <ul className="mt-3 space-y-2">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    onClick={() => setQuestion(ex)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(streaming || stageList.some((s) => s.state.status !== "pending")) && (
          <section
            className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            aria-live="polite"
          >
            <h2 className="text-sm font-semibold text-slate-800">Pipeline progress</h2>
            <ol className="mt-4 space-y-3">
              {stageList.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition",
                    s.state.status === "done" && "border-emerald-200 bg-emerald-50/40",
                    s.state.status === "active" &&
                      "border-slate-300 bg-slate-50 text-slate-900",
                    s.state.status === "error" && "border-red-200 bg-red-50/60",
                    s.state.status === "pending" && "border-slate-100 text-slate-400",
                  )}
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                    {s.state.status === "done" && (
                      <Check className="h-4 w-4 text-emerald-600" />
                    )}
                    {s.state.status === "active" && (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
                    )}
                    {s.state.status === "error" && (
                      <AlertCircle className="h-4 w-4 text-red-600" />
                    )}
                    {s.state.status === "pending" && (
                      <span className="h-2 w-2 rounded-full bg-slate-300" />
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block font-medium">{s.label}</span>
                    {s.state.message && (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {s.state.message}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {fatalError && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't generate a forecast</AlertTitle>
            <AlertDescription className="mt-1">
              {fatalError}
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={reset}>
                  Try again
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="mt-6 border-emerald-200 bg-emerald-50/60">
            <Check className="h-4 w-4 text-emerald-600" />
            <AlertTitle className="text-emerald-900">Forecast ready</AlertTitle>
            <AlertDescription className="text-emerald-800">
              Opening your event page…
            </AlertDescription>
          </Alert>
        )}
      </div>
    </SiteShell>
  );
}
