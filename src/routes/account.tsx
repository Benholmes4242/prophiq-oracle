import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  useActiveSubscription,
  useInvalidateSubscriptionState,
} from "../hooks/useActiveSubscription";
import { useUsageQuota } from "../hooks/useUsageQuota";
import { createCustomerPortalSession } from "../lib/billing";
import { Wordmark } from "../components/brand/Wordmark";
import { DeleteAccountModal } from "../components/account/DeleteAccountModal";
import { supabase } from "../lib/supabase";


export const Route = createFileRoute("/account")({
  component: AccountPage,
  head: () => ({
    meta: [{ title: "Account - prophiq." }],
  }),
});

function AccountPage() {
  const navigate = useNavigate();
  const { data: subscription, isLoading: subLoading } = useActiveSubscription();
  const { usage, isLoading: quotaLoading } = useUsageQuota();
  const invalidate = useInvalidateSubscriptionState();
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [nameError, setNameError] = useState<string | null>(null);

  // Refresh on mount in case the user just returned from Stripe Customer Portal.
  useEffect(() => {
    void invalidate();
  }, [invalidate]);

  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!mounted) return;
      setUserEmail(user?.email ?? null);
      setUserId(user?.id ?? null);
      setSignedOut(!user);
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        if (!mounted) return;
        const name = (profile?.display_name as string | null) ?? "";
        setDisplayName(name);
        setInitialName(name);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSaveName() {
    if (!userId) return;
    const trimmed = displayName.trim();
    setNameStatus("saving");
    setNameError(null);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed.length ? trimmed : null })
      .eq("id", userId);
    if (error) {
      setNameStatus("error");
      setNameError(error.message);
      return;
    }
    setDisplayName(trimmed);
    setInitialName(trimmed);
    setNameStatus("saved");
    setTimeout(() => setNameStatus((s) => (s === "saved" ? "idle" : s)), 2000);
  }



  async function handleManageSubscription() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const url = await createCustomerPortalSession();
      window.location.assign(url);
    } catch (e) {
      setPortalError((e as Error).message || "Failed to open subscription portal");
      setPortalLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  const isLoading = subLoading || quotaLoading;

  if (signedOut) {
    return (
      <div
        className="min-h-screen px-4 py-12 grid place-items-center"
        style={{ background: "var(--bg)", color: "var(--ink)" }}
      >
        <div className="text-center max-w-sm">
          <Wordmark className="mx-auto mb-6 h-9" />
          <h1 className="text-2xl font-bold mb-2">Your account</h1>
          <p className="text-sm text-[var(--ink)]/70 mb-6">
            Sign in to view your subscription, usage, and account settings.
          </p>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("prophiq:open-login", {
                  detail: { mode: "signup" },
                }),
              )
            }
            className="py-2.5 px-5 rounded-lg font-medium text-sm"
            style={{ background: "var(--ink)", color: "white" }}
          >
            Sign in or create a free account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen px-4 py-12"
      style={{ background: "var(--bg)", color: "var(--ink)" }}
    >
      <div className="mx-auto max-w-2xl">
        <Wordmark className="mx-auto mb-8 h-9" />
        <h1
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: "Geist, sans-serif", letterSpacing: "-0.02em" }}
        >
          Your account
        </h1>
        {userEmail && (
          <p className="text-sm text-[var(--ink)]/60 mb-8">
            Signed in as <span className="font-medium text-[var(--ink)]">{userEmail}</span>
          </p>
        )}
        {!userEmail && <div className="mb-8" />}

        {userId && (
          <div
            className="rounded-2xl border p-6 mb-6"
            style={{ background: "var(--bg)", borderColor: "var(--line)" }}
          >
            <h2 className="text-lg font-semibold mb-2">Your name</h2>
            <p className="text-sm text-[var(--ink)]/60 mb-3">
              Shown in your account. First name or full name — your call. Leave blank to clear.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (nameStatus !== "idle") setNameStatus("idle");
                }}
                placeholder="e.g. Alex"
                maxLength={80}
                className="flex-1 px-3 py-2 rounded-lg border text-sm"
                style={{ background: "var(--bg)", color: "var(--ink)", borderColor: "var(--line)" }}
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={nameStatus === "saving" || displayName.trim() === initialName.trim()}
                className="py-2 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
                style={{ background: "var(--ink)", color: "white" }}
              >
                {nameStatus === "saving" ? "Saving..." : "Save"}
              </button>
            </div>
            {nameStatus === "saved" && (
              <p className="mt-2 text-xs" style={{ color: "var(--ink)" }}>Saved.</p>
            )}
            {nameStatus === "error" && nameError && (
              <p className="mt-2 text-xs text-red-600">{nameError}</p>
            )}
          </div>
        )}



        {isLoading ? (
          <div className="text-center text-sm text-[var(--ink)]/60">Loading...</div>
        ) : (
          <>
            <div
              className="rounded-2xl border p-6 mb-6"
              style={{ background: "var(--bg)", borderColor: "var(--line)" }}
            >
              <h2 className="text-lg font-semibold mb-4">Subscription</h2>

              {subscription ? (
                <>
                  <dl className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-[var(--ink)]/60">Plan</dt>
                      <dd className="font-semibold capitalize">{subscription.tier}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[var(--ink)]/60">Status</dt>
                      <dd className="font-medium capitalize">
                        {subscription.status.replace("_", " ")}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[var(--ink)]/60">Billing cycle</dt>
                      <dd className="font-medium capitalize">{subscription.cadence}</dd>
                    </div>
                    {subscription.trial_end && (
                      <div className="flex justify-between">
                        <dt className="text-[var(--ink)]/60">Trial ends</dt>
                        <dd className="font-medium">
                          {new Date(subscription.trial_end).toLocaleDateString("en-GB", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <dt className="text-[var(--ink)]/60">
                        {subscription.cancel_at_period_end ? "Cancels on" : "Renews on"}
                      </dt>
                      <dd className="font-medium">
                        {new Date(subscription.current_period_end).toLocaleDateString("en-GB", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </dd>
                    </div>
                  </dl>

                  <button
                    onClick={handleManageSubscription}
                    disabled={portalLoading}
                    className="mt-6 w-full py-2.5 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
                    style={{ background: "var(--ink)", color: "white" }}
                  >
                    {portalLoading ? "Opening portal..." : "Manage subscription"}
                  </button>
                  {portalError && (
                    <p className="mt-2 text-xs text-red-600 text-center">{portalError}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--ink)]/70 mb-4">
                    You're on the free tier ({usage?.dailyCap ?? 3} forecasts per day).
                  </p>
                  <Link
                    to="/pricing"
                    className="inline-block py-2.5 px-4 rounded-lg font-medium text-sm"
                    style={{ background: "var(--ink)", color: "white" }}
                  >
                    {"View pricing \u2192"}
                  </Link>
                </>
              )}
            </div>

            {usage && (
              <div
                className="rounded-2xl border p-6"
                style={{ background: "var(--bg)", borderColor: "var(--line)" }}
              >
                <h2 className="text-lg font-semibold mb-4">Usage today</h2>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-3xl font-bold">{usage.used}</span>
                  <span className="text-sm text-[var(--ink)]/60">
                    of {usage.dailyCap} forecasts
                  </span>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ background: "var(--line)" }}
                >
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(usage.used / Math.max(1, usage.dailyCap)) * 100}%`,
                      background: "var(--ink)",
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-[var(--ink)]/60">Resets at midnight UTC.</p>
              </div>
            )}

            <div
              className="rounded-2xl border p-6 mt-6"
              style={{ background: "var(--bg)", borderColor: "var(--line)" }}
            >
              <h2 className="text-lg font-semibold mb-2">Session</h2>
              <p className="text-sm text-[var(--ink)]/70 mb-4">
                Sign out of your Prophiq account on this device.
              </p>
              <button
                onClick={handleSignOut}
                className="py-2.5 px-4 rounded-lg font-medium text-sm border"
                style={{
                  background: "var(--bg)",
                  color: "var(--ink)",
                  borderColor: "var(--line)",
                }}
              >
                Sign out
              </button>
            </div>

            <div
              className="rounded-2xl border p-6 mt-6"
              style={{ background: "var(--bg)", borderColor: "#FECACA" }}
            >
              <h2
                className="text-lg font-semibold mb-2"
                style={{ color: "var(--ink)" }}
              >
                Danger zone
              </h2>
              <p className="text-sm text-[var(--ink)]/70 mb-4">
                Permanently delete your Prophiq account, cancel your
                subscription, and remove all your data.
              </p>
              <button
                onClick={() => setDeleteOpen(true)}
                className="py-2.5 px-4 rounded-lg font-medium text-sm border"
                style={{
                  background: "var(--bg)",
                  color: "#B91C1C",
                  borderColor: "#B91C1C",
                }}
              >
                Delete my account
              </button>
            </div>
          </>
        )}
      </div>
      <DeleteAccountModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        userEmail={userEmail}
      />
    </div>

  );
}
