import type { LLMProvider } from "./organization";

export interface SingleWordRule {
  type: "single_word";
  value: string; // regex pattern, case-insensitive
}

export interface WordSetRule {
  type: "word_set";
  words: string[]; // all must appear in message (any order, case-insensitive)
}

export interface PhraseRule {
  type: "phrase";
  intent: string; // description of intent, e.g. "Pode finalizar esse atendimento"
  confidence_threshold: number; // 0-1, default 0.7; below 0.35 = ignore; 0.35-threshold = confirm
}

export type ActivationRule = SingleWordRule | WordSetRule | PhraseRule;

export interface Agent {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  provider: LLMProvider;
  temperature: number;
  max_tokens: number;
  max_steps: number;
  tools_config: ToolsConfig;
  is_active: boolean;
  activation_rules: ActivationRule[];
  created_at: string;
  updated_at: string;
}

export interface ToolsConfig {
  search_knowledge: boolean;
  search_faq: boolean;
  search_web: boolean;
  search_products: boolean;
}
