"use client";

import { createClient } from "@/lib/supabase/client";
import { ChipsInput } from "@/components/ui/chips-input";

interface TagsInputProps {
  conversationId: string;
  tags: string[];
  onUpdate: () => void;
}

export function TagsInput({ conversationId, tags, onUpdate }: TagsInputProps) {
  const handleChange = (newTags: string[]) => {
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ tags: newTags })
      .eq("id", conversationId)
      .then(() => onUpdate())
      .catch((err) => {
        console.error("[tags-input] Falha ao atualizar tags:", err);
        onUpdate(); // refresh from DB to revert the optimistic chip change
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
