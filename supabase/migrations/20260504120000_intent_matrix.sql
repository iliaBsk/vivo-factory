CREATE TABLE vivo_intent_matrix (
  id               BIGSERIAL PRIMARY KEY,
  audience_id      UUID NOT NULL REFERENCES vivo_audiences(id) ON DELETE CASCADE,
  extracted_at     TIMESTAMPTZ NOT NULL,
  horizon          TEXT NOT NULL,
  domain           TEXT NOT NULL,
  goals            JSONB NOT NULL DEFAULT '[]',
  desires          JSONB NOT NULL DEFAULT '[]',
  fears            JSONB NOT NULL DEFAULT '[]',
  anti_goals       JSONB NOT NULL DEFAULT '[]',
  needs            JSONB NOT NULL DEFAULT '[]',
  relevant_to_know JSONB NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'normal',
  raw_response     JSONB
);

CREATE UNIQUE INDEX ON vivo_intent_matrix(audience_id, extracted_at, horizon, domain);
CREATE INDEX ON vivo_intent_matrix(audience_id, extracted_at DESC);

CREATE TABLE vivo_intent_diffs (
  id                 BIGSERIAL PRIMARY KEY,
  audience_id        UUID NOT NULL REFERENCES vivo_audiences(id) ON DELETE CASCADE,
  computed_at        TIMESTAMPTZ NOT NULL,
  horizon            TEXT NOT NULL,
  domain             TEXT NOT NULL,
  diff               JSONB NOT NULL,
  significance_score NUMERIC
);

CREATE INDEX ON vivo_intent_diffs(audience_id, computed_at DESC);

CREATE TABLE vivo_data_gaps (
  id                BIGSERIAL PRIMARY KEY,
  audience_id       UUID NOT NULL REFERENCES vivo_audiences(id) ON DELETE CASCADE,
  field_path        TEXT NOT NULL,
  gap_description   TEXT,
  noticed_at        TIMESTAMPTZ DEFAULT NOW(),
  resolution_status TEXT DEFAULT 'open'
);
