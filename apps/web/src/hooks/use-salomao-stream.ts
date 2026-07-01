"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type StreamState = "idle" | "connecting" | "streaming" | "done" | "error";

interface StreamEvent {
  type: "chunk" | "prompt" | "done" | "error";
  content?: string;
  message?: string;
}

interface UseSalomaoStreamOptions {
  organizationId: string | undefined;
  onChunk: (text: string) => void;
  onPromptReady: (prompt: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function useSalomaoStream({
  organizationId,
  onChunk,
  onPromptReady,
  onDone,
  onError,
}: UseSalomaoStreamOptions) {
  const [state, setState] = useState<StreamState>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  const send = useCallback(
    async (messages: ChatMessage[]) => {
      if (!organizationId) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setState("connecting");

      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setState("error");
          onError("Sessão expirada. Faça login novamente.");
          return;
        }

        const res = await fetch(
          `${apiBase}/organizations/${organizationId}/prompt-studio/chat/stream`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token ?? ""}`,
            },
            body: JSON.stringify({ messages }),
            signal: abortRef.current.signal,
          }
        );

        if (!res.ok || !res.body) {
          setState("error");
          onError("Erro ao conectar com Salomão");
          return;
        }

        setState("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let receivedDone = false;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event = JSON.parse(data) as StreamEvent;
              if (event.type === "chunk" && event.content) {
                onChunk(event.content);
              } else if (event.type === "prompt" && event.content) {
                onPromptReady(event.content);
              } else if (event.type === "done") {
                receivedDone = true;
                setState("done");
                onDone();
                break outer;
              } else if (event.type === "error") {
                receivedDone = true;
                setState("error");
                onError(event.message ?? "Erro desconhecido");
                break outer;
              }
            } catch {
              // Ignora linhas malformadas
            }
          }
        }

        // Conexão fechou sem evento done: stream foi truncada, tratar como erro
        if (!receivedDone) {
          setState("error");
          onError("Conexão interrompida antes de concluir");
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState("error");
        onError("Conexão interrompida");
      }
    },
    [organizationId, apiBase, onChunk, onPromptReady, onDone, onError]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
  }, []);

  return { state, send, abort };
}
