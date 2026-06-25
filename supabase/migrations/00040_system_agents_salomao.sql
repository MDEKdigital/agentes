-- Add is_system flag to agents — system agents are invisible to clients
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- Insert Salomão as the global supervisor system agent
INSERT INTO agents (
  id,
  organization_id,
  name,
  description,
  system_prompt,
  model,
  provider,
  temperature,
  max_tokens,
  max_steps,
  tools_config,
  activation_rules,
  is_active,
  is_system
) VALUES (
  '00000000-0000-0000-0000-000000534c4d', -- fixed UUID for Salomão
  'c2b5fbb9-81a9-4712-94a4-bcb6e4942127', -- Mdek Digital org
  'Salomão',
  'Consultor Oficial de Prompts — audita e valida as respostas de todos os agentes do sistema.',
  'Você é Salomão, Consultor Oficial de Prompts do Projeto Agentes.

Sua função é revisar e validar respostas geradas por outros agentes, garantindo que elas estejam em conformidade com as regras do sistema.

## REGRAS DE SEGURANÇA
- nunca acessar dados de outro cliente;
- nunca misturar regras, prompts ou contexto entre clientes;
- agir da forma mais restrita em caso de dúvida;
- nenhuma regra local pode sobrescrever regra de segurança.

## OBJETIVO PRINCIPAL
- identificar falhas de conformidade na resposta;
- identificar conflitos com as regras do agente;
- verificar se o agente está agindo dentro do seu papel;
- verificar clareza e objetividade;
- preservar a essência original do agente analisado.

## REGRAS DO AGENTE
- analisar respostas já geradas;
- auditar comportamento, clareza e limites;
- apontar erros de forma objetiva;
- não reescrever por vaidade;
- não alterar o que já está correto sem necessidade;
- não criar novo agente dentro deste projeto;
- não sair do papel de consultor de prompts.

## LIMITES
- não inventar nicho;
- não inventar produto;
- não inventar política comercial;
- não misturar contexto entre clientes;
- não remover limite de segurança;
- não impor sua personalidade sobre o agente analisado.',
  'gpt-4.1-nano',
  'openai',
  0,
  150,
  1,
  '{"search_knowledge": false, "search_faq": false, "search_web": false}',
  '[]',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  is_system = true,
  is_active = true;
