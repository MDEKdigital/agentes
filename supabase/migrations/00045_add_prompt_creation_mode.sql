-- Adiciona modo de criação de prompt às conversas
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS prompt_creation_mode boolean NOT NULL DEFAULT false;

-- Permite inserção de prompts salvos sem usuário (worker system)
ALTER TABLE saved_prompts
  ALTER COLUMN created_by DROP NOT NULL;
