"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ChipsInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export function ChipsInput({ value, onChange, placeholder = "Adicionar..." }: ChipsInputProps) {
  const [input, setInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput("");
  };

  const remove = (chip: string) => {
    onChange(value.filter((c) => c !== chip));
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="flex flex-wrap gap-1.5">
        {value.map((chip) => (
          <span
            key={chip}
            className="flex items-center gap-1 rounded-md border border-border bg-elevated px-2 py-0.5 text-[11px] font-medium text-foreground"
          >
            {chip}
            <button
              type="button"
              onClick={() => remove(chip)}
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
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
        }}
        onBlur={(e) => {
          // Don't commit partial input if focus is moving to a chip's remove button
          // inside this same component (blur fires before click in browser event order).
          if (containerRef.current?.contains(e.relatedTarget as Node)) return;
          add();
        }}
        placeholder={placeholder}
        className="h-7 bg-muted border-border text-xs placeholder:text-muted-foreground"
      />
    </div>
  );
}
