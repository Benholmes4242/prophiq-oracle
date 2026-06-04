-- Brief FF v2 / Phase A — Binary sub-questions infrastructure.
--
-- 1. events.parent_event_id    : self-referencing FK so sub-questions hang off
--                                their parent event.
-- 2. sub_question_templates    : per-domain × sub_category seed of binary
--                                templates with {favorite}/{field_size} tokens.
-- 3. prediction_inputs.structured_data_sources
--                              : forward-compat lineage column for Brief GG.

-- ---------- 1. parent_event_id ----------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS parent_event_id uuid
    REFERENCES public.events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_events_parent_event_id
  ON public.events(parent_event_id)
  WHERE parent_event_id IS NOT NULL;

COMMENT ON COLUMN public.events.parent_event_id IS
  'Set on sub-questions to point at the parent event. NULL for top-level events.';

-- ---------- 2. sub_question_templates ----------
CREATE TABLE IF NOT EXISTS public.sub_question_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        text NOT NULL,
  sub_category  text NOT NULL,
  template      text NOT NULL,
  outcomes      jsonb NOT NULL DEFAULT '["Yes","No"]'::jsonb,
  display_order int  NOT NULL DEFAULT 0,
  active        bool NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_q_templates_lookup
  ON public.sub_question_templates(domain, sub_category)
  WHERE active = true;

GRANT SELECT ON public.sub_question_templates TO anon, authenticated;
GRANT ALL    ON public.sub_question_templates TO service_role;

ALTER TABLE public.sub_question_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_question_templates_public_read"
  ON public.sub_question_templates FOR SELECT USING (true);

-- ---------- 3. structured_data_sources (forward-compat, Brief GG) ----------
ALTER TABLE public.prediction_inputs
  ADD COLUMN IF NOT EXISTS structured_data_sources jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.prediction_inputs.structured_data_sources IS
  'JSONB array of structured data provider tags fed to LLMs. Populated by Brief GG. Empty array = no structured data used.';

-- ---------- 4. Seed templates ----------
INSERT INTO public.sub_question_templates (domain, sub_category, template, outcomes, display_order) VALUES
-- ===== SPORT =====
('sport','horse_racing','Will {favorite} win the race?','["Yes","No"]',1),
('sport','horse_racing','Will the winning margin be more than 2 lengths?','["Yes","No"]',2),
('sport','horse_racing','Will the favorite finish in the top 3?','["Yes","No"]',3),

('sport','football','Will {favorite} win in regulation?','["Yes","No"]',1),
('sport','football','Will both teams score?','["Yes","No"]',2),
('sport','football','Will the match have more than 2.5 total goals?','["Yes","No"]',3),

('sport','basketball','Will {favorite} win?','["Yes","No"]',1),
('sport','basketball','Will the winning margin be more than 10 points?','["Yes","No"]',2),
('sport','basketball','Will the total points be over 220?','["Yes","No"]',3),

('sport','baseball','Will {favorite} win?','["Yes","No"]',1),
('sport','baseball','Will the total runs be over 8.5?','["Yes","No"]',2),

('sport','american_football','Will {favorite} win?','["Yes","No"]',1),
('sport','american_football','Will the winning margin be more than 7 points?','["Yes","No"]',2),
('sport','american_football','Will the total points be over 45?','["Yes","No"]',3),

('sport','hockey','Will {favorite} win in regulation?','["Yes","No"]',1),
('sport','hockey','Will the game go to overtime?','["Yes","No"]',2),

('sport','golf','Will {favorite} win the tournament?','["Yes","No"]',1),
('sport','golf','Will the winner finish under par?','["Yes","No"]',2),
('sport','golf','Will the winning margin be more than 2 strokes?','["Yes","No"]',3),

('sport','tennis','Will {favorite} win in straight sets?','["Yes","No"]',1),
('sport','tennis','Will the match go to a deciding set?','["Yes","No"]',2),

('sport','f1','Will {favorite} win the race?','["Yes","No"]',1),
('sport','f1','Will there be a safety car deployed?','["Yes","No"]',2),
('sport','f1','Will the pole sitter finish on the podium?','["Yes","No"]',3),

('sport','mma','Will {favorite} win?','["Yes","No"]',1),
('sport','mma','Will the fight end inside the distance?','["Yes","No"]',2),

('sport','cricket','Will {favorite} win?','["Yes","No"]',1),
('sport','cricket','Will the first innings total exceed 250?','["Yes","No"]',2),

('sport','college_sports','Will {favorite} win?','["Yes","No"]',1),
('sport','college_sports','Will the winning margin be more than 10 points?','["Yes","No"]',2),

-- ===== POLITICS =====
('politics','election','Will {favorite} win?','["Yes","No"]',1),
('politics','election','Will turnout exceed the prior election?','["Yes","No"]',2),
('politics','election','Will the winning margin be more than 5 percentage points?','["Yes","No"]',3),

('politics','leadership_contest','Will {favorite} win on the first ballot?','["Yes","No"]',1),
('politics','leadership_contest','Will the contest require more than one round of voting?','["Yes","No"]',2),

('politics','parliamentary_vote','Will the motion pass?','["Yes","No"]',1),
('politics','parliamentary_vote','Will the vote split along party lines?','["Yes","No"]',2),

('politics','referendum','Will the Yes side win?','["Yes","No"]',1),
('politics','referendum','Will turnout exceed 50%?','["Yes","No"]',2),

('politics','confirmation','Will the nominee be confirmed?','["Yes","No"]',1),
('politics','confirmation','Will the confirmation vote be along party lines?','["Yes","No"]',2),

-- ===== MARKETS =====
('markets','central_bank','Will the central bank hold rates?','["Yes","No"]',1),
('markets','central_bank','Will the statement be more hawkish than the prior meeting?','["Yes","No"]',2),

('markets','earnings','Will the company beat consensus EPS?','["Yes","No"]',1),
('markets','earnings','Will the company beat consensus revenue?','["Yes","No"]',2),
('markets','earnings','Will guidance be raised?','["Yes","No"]',3),

('markets','ipo','Will the IPO price above the indicated range?','["Yes","No"]',1),
('markets','ipo','Will the stock close above its IPO price on day one?','["Yes","No"]',2),

('markets','economic_data','Will the print beat consensus?','["Yes","No"]',1),
('markets','economic_data','Will the print exceed the prior reading?','["Yes","No"]',2),

('markets','currency','Will the pair close higher than today?','["Yes","No"]',1),

('markets','commodity','Will the price close higher than today?','["Yes","No"]',1),

-- ===== ENTERTAINMENT =====
('entertainment','awards','Will {favorite} win?','["Yes","No"]',1),
('entertainment','awards','Will the frontrunner win in their category?','["Yes","No"]',2),

('entertainment','film_release','Will the film open above $50M domestically?','["Yes","No"]',1),
('entertainment','film_release','Will the Rotten Tomatoes score be above 80%?','["Yes","No"]',2),

('entertainment','album_release','Will the album debut at #1?','["Yes","No"]',1),
('entertainment','album_release','Will it sell over 100k units in week one?','["Yes","No"]',2),

('entertainment','reality_show','Will {favorite} win?','["Yes","No"]',1),
('entertainment','reality_show','Will the finale draw a larger audience than last season?','["Yes","No"]',2)
ON CONFLICT DO NOTHING;
