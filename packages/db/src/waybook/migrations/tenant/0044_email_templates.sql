CREATE TABLE IF NOT EXISTS email_templates (
  tenant_id UUID NOT NULL,
  template_key TEXT NOT NULL CHECK (template_key IN ('booking', 'confirmation', 'cancellation', 'sale')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, template_key)
);
