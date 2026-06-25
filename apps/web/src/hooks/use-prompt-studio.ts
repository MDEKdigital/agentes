"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface SavedPrompt {
  id: string;
  organization_id: string;
  name: string;
  niche: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function usePromptStudio(organizationId: string | undefined) {
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [loading, setLoading] = useState(true);

  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  const getHeaders = async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    };
  };

  const fetchSavedPrompts = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const h = await getHeaders();
      const r = await fetch(`${apiBase}/organizations/${organizationId}/saved-prompts`, { headers: h });
      const data = await r.json();
      setSavedPrompts(data.prompts ?? []);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { fetchSavedPrompts(); }, [fetchSavedPrompts]);

  async function sendMessage(messages: ChatMessage[]): Promise<string> {
    const h = await getHeaders();
    const r = await fetch(`${apiBase}/organizations/${organizationId}/prompt-studio/chat`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ messages }),
    });
    if (!r.ok) throw new Error("Erro ao chamar Salomão");
    const data = await r.json();
    return data.message as string;
  }

  async function transcribeAudio(base64: string, mimeType: string): Promise<string> {
    const h = await getHeaders();
    const r = await fetch(`${apiBase}/organizations/${organizationId}/prompt-studio/transcribe`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ base64, mimeType }),
    });
    if (!r.ok) throw new Error("Erro ao transcrever áudio");
    const data = await r.json();
    return data.text as string;
  }

  async function savePrompt(name: string, niche: string, content: string): Promise<SavedPrompt> {
    const h = await getHeaders();
    const r = await fetch(`${apiBase}/organizations/${organizationId}/saved-prompts`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ name, niche, content }),
    });
    if (!r.ok) throw new Error("Erro ao salvar prompt");
    const saved = await r.json();
    setSavedPrompts((prev) => [saved, ...prev]);
    return saved as SavedPrompt;
  }

  async function updatePrompt(promptId: string, updates: Partial<Pick<SavedPrompt, "name" | "niche" | "content">>): Promise<SavedPrompt> {
    const h = await getHeaders();
    const r = await fetch(`${apiBase}/organizations/${organizationId}/saved-prompts/${promptId}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error("Erro ao atualizar prompt");
    const updated = await r.json();
    setSavedPrompts((prev) => prev.map((p) => p.id === promptId ? updated : p));
    return updated as SavedPrompt;
  }

  async function deletePrompt(promptId: string) {
    const h = await getHeaders();
    await fetch(`${apiBase}/organizations/${organizationId}/saved-prompts/${promptId}`, {
      method: "DELETE",
      headers: h,
    });
    setSavedPrompts((prev) => prev.filter((p) => p.id !== promptId));
  }

  return {
    savedPrompts,
    loading,
    sendMessage,
    transcribeAudio,
    savePrompt,
    updatePrompt,
    deletePrompt,
    refresh: fetchSavedPrompts,
  };
}
