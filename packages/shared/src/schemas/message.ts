import { z } from "zod";

export const sendMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  content: z.string().min(1).max(10000),
  idempotency_key: z.string().min(1).max(128).optional(),
});
