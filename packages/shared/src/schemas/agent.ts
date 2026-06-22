import { z } from "zod";
import { isValidRegex } from "../utils/keyword";

export const toolsConfigSchema = z.object({
  search_knowledge: z.boolean().default(true),
  search_faq: z.boolean().default(true),
});

export const singleWordRuleSchema = z.object({
  type: z.literal("single_word"),
  value: z.string().min(1).refine(isValidRegex, { message: "Regex inválida ou com risco de ReDoS" }),
});

export const wordSetRuleSchema = z.object({
  type: z.literal("word_set"),
  words: z.array(z.string().min(1)).min(2, { message: "word_set precisa de pelo menos 2 palavras" }),
});

export const phraseRuleSchema = z.object({
  type: z.literal("phrase"),
  intent: z.string().min(1).max(500),
  confidence_threshold: z.number().min(0).max(1).default(0.7),
});

export const activationRuleSchema = z.discriminatedUnion("type", [
  singleWordRuleSchema,
  wordSetRuleSchema,
  phraseRuleSchema,
]);

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(50000).default(""),
  system_prompt: z.string().min(1).max(50000),
  model: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "google"]),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().min(1).max(16384).default(1024),
  max_steps: z.number().int().min(1).max(20).default(5),
  tools_config: toolsConfigSchema.default({ search_knowledge: true, search_faq: true }),
  activation_rules: z.array(activationRuleSchema).default([]),
  is_active: z.boolean().default(true),
});

export const updateAgentSchema = createAgentSchema.partial();
