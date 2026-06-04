// Brief FF v2 / Phase A — Sub-question generation helper.
//
// Reads sub_question_templates for (domain, sub_category), substitutes
// {favorite} and {field_size} tokens (null-safe), and inserts one child
// event per template with parent_event_id pointing at the parent. Each
// child event gets its outcomes inserted as well. All operations are
// idempotent via the existing (domain, external_id) unique constraint on
// events plus (event_id, external_id) on event_outcomes.
//
// Called from discover-events after each successful parent upsert, and
// from db/scripts/backfill_sub_questions.ts for retroactive backfill.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { stableEventId } from "./domains/_util.ts";

export interface SubQuestionParent {
  id: string;
  domain: string;
  slug: string;
  title: string;
  starts_at: string;
  resolves_at: string;
  mode: string;
  metadata: Record<string, unknown> | null;
}

interface TemplateRow {
  id: string;
  domain: string;
  sub_category: string;
  template: string;
  outcomes: unknown;
  display_order: number;
}

function substitute(
  template: string,
  vars: { favorite: string; field_size: string },
): string {
  return template
    .replace(/\{favorite\}/g, vars.favorite)
    .replace(/\{field_size\}/g, vars.field_size);
}

export interface GenerateSubQuestionsResult {
  attempted: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export async function generateSubQuestions(
  supabase: SupabaseClient,
  parent: SubQuestionParent,
): Promise<GenerateSubQuestionsResult> {
  const res: GenerateSubQuestionsResult = {
    attempted: 0, inserted: 0, skipped: 0, errors: [],
  };

  const meta = parent.metadata ?? {};
  const subCategory = typeof (meta as Record<string, unknown>).sub_category === "string"
    ? ((meta as Record<string, unknown>).sub_category as string)
    : null;
  if (!subCategory) {
    res.skipped = 1;
    return res;
  }

  // Null-safe fallbacks for template tokens.
  const favorite = typeof (meta as Record<string, unknown>).favorite_label === "string"
    && ((meta as Record<string, unknown>).favorite_label as string).trim().length > 0
    ? ((meta as Record<string, unknown>).favorite_label as string).trim()
    : "the favorite";
  const fieldSize = typeof (meta as Record<string, unknown>).field_size === "number"
    ? String((meta as Record<string, unknown>).field_size)
    : "the field";

  const { data: templates, error: tErr } = await supabase
    .from("sub_question_templates")
    .select("id, domain, sub_category, template, outcomes, display_order")
    .eq("domain", parent.domain)
    .eq("sub_category", subCategory)
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (tErr) {
    res.errors.push(`templates query: ${tErr.message}`);
    return res;
  }
  const tmpls = (templates ?? []) as TemplateRow[];
  res.attempted = tmpls.length;
  if (tmpls.length === 0) return res;

  for (const t of tmpls) {
    try {
      const question = substitute(t.template, { favorite, field_size: fieldSize });
      const title = question;
      const externalId = await stableEventId(
        `subq:${t.id}:${parent.id}:${question}`,
        parent.starts_at,
      );
      const slug = `${parent.slug}-sq-${externalId.slice(0, 8)}`;

      const childMetadata = {
        sub_question: true,
        template_id: t.id,
        parent_slug: parent.slug,
        sub_category: subCategory,
      };

      const { data: inserted, error: eErr } = await supabase
        .from("events")
        .upsert({
          domain: parent.domain,
          external_id: externalId,
          slug,
          title,
          question,
          starts_at: parent.starts_at,
          resolves_at: parent.resolves_at,
          status: "scheduled",
          mode: "prediction",
          source: "discovered",
          moderation_status: "approved",
          parent_event_id: parent.id,
          metadata: childMetadata,
        }, { onConflict: "domain,external_id" })
        .select("id, created_at, updated_at")
        .single();

      if (eErr || !inserted) {
        res.errors.push(`sub-event upsert: ${eErr?.message ?? "no row"}`);
        res.skipped++;
        continue;
      }

      const isNew = inserted.created_at === inserted.updated_at;
      if (isNew) res.inserted++;

      const outcomeLabels = Array.isArray(t.outcomes)
        ? (t.outcomes as unknown[]).filter((x): x is string => typeof x === "string")
        : ["Yes", "No"];
      const rows = outcomeLabels.map((label) => ({
        event_id: inserted.id,
        external_id: label,
        label,
      }));
      const { error: oErr } = await supabase
        .from("event_outcomes")
        .upsert(rows, { onConflict: "event_id,external_id" });
      if (oErr) res.errors.push(`sub-outcomes upsert: ${oErr.message}`);
    } catch (e) {
      res.errors.push(`sub-question error: ${(e as Error).message}`);
      res.skipped++;
    }
  }

  return res;
}
