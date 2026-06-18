"use client";

import { apiFetch } from "@/lib/api";
import { ChipsInput } from "@/components/ui/chips-input";

interface TagsInputProps {
  conversationId: string;
  tags: string[];
  onUpdate: () => void;
}

export function TagsInput({ conversationId, tags, onUpdate }: TagsInputProps) {
  const handleChange = (newTags: string[]) => {
    void apiFetch(`/conversations/${conversationId}/tags`, {
      method: "PATCH",
      body: JSON.stringify({ tags: newTags }),
    })
      .then(() => onUpdate())
      .catch((err) => {
        console.error("[tags-input] Falha ao atualizar tags:", err);
        onUpdate();
      });
  };

  return (
    <ChipsInput
      value={tags}
      onChange={handleChange}
      placeholder="Adicionar tag..."
    />
  );
}
