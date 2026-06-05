-- Brief II Phase B: seed the health_checks registry.
-- 14 active services + api_sports as a 15th legacy entry (enabled=false).
-- All inserts use ON CONFLICT DO NOTHING so re-runs are safe.

INSERT INTO public.health_checks (key, label, category, enabled, critical, expected_latency_ms) VALUES
  ('anthropic',     'Anthropic (Claude)',    'llm',             true, true,  1500),
  ('openai',        'OpenAI (GPT)',          'llm',             true, true,  1500),
  ('google',        'Google (Gemini)',       'llm',             true, true,  1500),
  ('perplexity',    'Perplexity (research)', 'research',        true, true,  2000),
  ('fred',          'FRED (macro)',          'structured_data', true, false, 1500),
  ('alpha_vantage', 'Alpha Vantage',         'structured_data', true, false, 1500),
  ('polymarket',    'Polymarket',            'structured_data', true, false, 1500),
  ('kalshi',        'Kalshi',                'structured_data', true, false, 1500),
  ('football_data', 'football-data.org',     'structured_data', true, false, 1500),
  ('thesportsdb',   'TheSportsDB',           'structured_data', true, false, 1500),
  ('tmdb',          'TMDb',                  'structured_data', true, false, 1500),
  ('spotify',       'Spotify',               'structured_data', true, false, 2000),
  ('stripe',        'Stripe',                'payments',        true, true,  1500),
  ('resend',        'Resend',                'infra',           true, true,  1500),
  ('supabase_db',   'Supabase DB',           'infra',           true, true,  300),
  -- Legacy api-sports v3 source. Disabled by default; flagged to Ben for
  -- confirmation (open question 1 in the Phase B brief).
  ('api_sports',    'API-Sports (legacy)',   'structured_data', false, false, 1500)
ON CONFLICT (key) DO NOTHING;
