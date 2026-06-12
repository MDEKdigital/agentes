"use client";

import { createClient } from "@/lib/supabase/client";
import { ChipsInput } from "@/components/ui/chips-input";

interface TagsInputProps {
  conversationId: string;
  tags: string[];
  onUpdate: () => void;
}

export function TagsInput({ conversationId, tags, onUpdate }: TagsInputProps) {
  const handleChange = async (newTags: string[]) => {
    const supabase = createClient();
    await supabase.from("conversations").update({ tags: newTags }).eq("id", conversationId);
    onUpdate();
  };

  return (
    <ChipsInput
      value={tags}
      onChange={handleChange}
      placeholder="Adicionar tag..."
    />
  );
}
