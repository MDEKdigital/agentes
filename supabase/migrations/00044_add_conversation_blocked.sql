ALTER TABLE conversations
  ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;
