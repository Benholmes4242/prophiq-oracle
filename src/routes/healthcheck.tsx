import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/healthcheck")({
  head: () => ({ meta: [{ title: "Prophiq — Healthcheck" }] }),
  component: HealthcheckPage,
});

type Status = "checking" | "ok" | "error";

function HealthcheckPage() {
  const [authStatus, setAuthStatus] = useState<Status>("checking");
  const [authDetail, setAuthDetail] = useState<string>("");
  const [eventsStatus, setEventsStatus] = useState<Status>("checking");
  const [eventsDetail, setEventsDetail] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const { error } = await supabase.auth.getSession();
        if (error) throw error;
        setAuthStatus("ok");
        setAuthDetail("Supabase reachable, anon key accepted.");
      } catch (e) {
        setAuthStatus("error");
        setAuthDetail(e instanceof Error ? e.message : String(e));
      }

      try {
        const { count, error } = await supabase
          .from("events")
          .select("*", { count: "exact", head: true });
        if (error) throw error;
        setEventsStatus("ok");
        setEventsDetail(`events table reachable. row count: ${count ?? 0}`);
      } catch (e) {
        setEventsStatus("error");
        setEventsDetail(
          e instanceof Error
            ? e.message
            : "events table not reachable (expected before Phase 1 is deployed).",
        );
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">Prophiq — Connection Healthcheck</h1>
        <p className="text-sm text-muted-foreground">
          URL: <code>{import.meta.env.VITE_SUPABASE_URL}</code>
        </p>
        <Row label="Supabase auth endpoint" status={authStatus} detail={authDetail} />
        <Row label="events table (post-Phase 1)" status={eventsStatus} detail={eventsDetail} />
      </div>
    </div>
  );
}

function Row({ label, status, detail }: { label: string; status: Status; detail: string }) {
  const color =
    status === "ok"
      ? "text-green-600"
      : status === "error"
        ? "text-red-600"
        : "text-muted-foreground";
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className={`text-sm font-mono ${color}`}>{status.toUpperCase()}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground break-all">{detail}</p>
    </div>
  );
}
