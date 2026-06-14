ALTER TABLE remarketing_steps
  ADD COLUMN delay_value integer NOT NULL DEFAULT 60,
  ADD COLUMN delay_unit  text    NOT NULL DEFAULT 'minutes'
    CHECK (delay_unit IN ('minutes', 'hours', 'days'));

-- Migrar registros existentes (se houver)
UPDATE remarketing_steps SET delay_value = wait_minutes, delay_unit = 'minutes';

ALTER TABLE remarketing_steps DROP COLUMN wait_minutes;
