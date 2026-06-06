"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface TagsInputProps {
  conversationId: string;
  tags: string[];
  onUpdate: () => void;
}

export function TagsInput({ conversationId, tags, onUpdate }: TagsInputProps) {
  const [input, setInput] = useState("");

  const handleAdd = async () => {
    if (!input.trim() || tags.includes(input.trim())) return;
    const newTags = [...tags, input.trim()];
    const supabase = createClient();
    await supabase.from("conversations").update({ tags: newTags }).eq("id", conversationId);
    setInput("");
    onUpdate();
  };

  const handleRemove = async (tag: string) => {
    const newTags = tags.filter((t) => t !== tag);
    const supabase = createClient();
    await supabase.from("conversations").update({ tags: newTags }).eq("id", conversationId);
    onUpdate();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md border border-border bg-elevated px-2 py-0.5 text-[11px] font-medium text-foreground"
          >
            {tag}
            <button
              onClick={() => handleRemove(tag)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        placeholder="Adicionar tag..."
        className="h-7 bg-muted border-border text-xs placeholder:text-muted-foreground"
      />
    </div>
  );
}
