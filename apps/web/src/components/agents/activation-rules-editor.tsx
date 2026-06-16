"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";
import type { ActivationRule } from "@aula-agente/shared";

interface Props {
  value: ActivationRule[];
  onChange: (rules: ActivationRule[]) => void;
}

type DraftType = "single_word" | "word_set" | "phrase";

export function ActivationRulesEditor({ value, onChange }: Props) {
  const [draftType, setDraftType] = useState<DraftType>("single_word");
  const [draftValue, setDraftValue] = useState("");
  const [draftWords, setDraftWords] = useState("");
  const [draftIntent, setDraftIntent] = useState("");
  const [draftThreshold, setDraftThreshold] = useState("0.7");

  function addRule() {
    let rule: ActivationRule | null = null;

    if (draftType === "single_word" && draftValue.trim()) {
      rule = { type: "single_word", value: draftValue.trim() };
      setDraftValue("");
    } else if (draftType === "word_set") {
      const words = draftWords.split(",").map((w) => w.trim()).filter(Boolean);
      if (words.length >= 2) {
        rule = { type: "word_set", words };
        setDraftWords("");
      }
    } else if (draftType === "phrase" && draftIntent.trim()) {
      const threshold = parseFloat(draftThreshold);
      rule = {
        type: "phrase",
        intent: draftIntent.trim(),
        confidence_threshold: isNaN(threshold) ? 0.7 : Math.min(1, Math.max(0, threshold)),
      };
      setDraftIntent("");
    }

    if (rule) onChange([...value, rule]);
  }

  function removeRule(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function ruleLabel(rule: ActivationRule): string {
    if (rule.type === "single_word") return `Palavra: ${rule.value}`;
    if (rule.type === "word_set") return `Conjunto: ${rule.words.join(" + ")}`;
    return `Frase: ${rule.intent} (≥${(rule.confidence_threshold * 100).toFixed(0)}%)`;
  }

  function ruleVariant(type: string): "default" | "secondary" | "outline" {
    if (type === "single_word") return "default";
    if (type === "word_set") return "secondary";
    return "outline";
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.map((rule, i) => (
          <Badge key={JSON.stringify(rule)} variant={ruleVariant(rule.type)} className="gap-1 pr-1">
            {ruleLabel(rule)}
            <button
              type="button"
              aria-label="Remover regra"
              onClick={() => removeRule(i)}
              className="ml-1 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {value.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma regra — agente sempre responde.</p>
        )}
      </div>

      <div className="flex items-start gap-2 flex-wrap">
        <Select value={draftType} onValueChange={(v) => setDraftType(v as DraftType)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single_word">Palavra</SelectItem>
            <SelectItem value="word_set">Conjunto</SelectItem>
            <SelectItem value="phrase">Frase</SelectItem>
          </SelectContent>
        </Select>

        {draftType === "single_word" && (
          <Input
            className="flex-1 min-w-40"
            placeholder="cancelar (regex válida)"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())}
          />
        )}

        {draftType === "word_set" && (
          <Input
            className="flex-1 min-w-40"
            placeholder="resolver, atendimento (separadas por vírgula)"
            value={draftWords}
            onChange={(e) => setDraftWords(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())}
          />
        )}

        {draftType === "phrase" && (
          <>
            <Input
              className="flex-1 min-w-40"
              placeholder="Ex: Pode finalizar esse atendimento."
              value={draftIntent}
              onChange={(e) => setDraftIntent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())}
            />
            <Input
              className="w-24"
              type="number"
              min="0"
              max="1"
              step="0.05"
              placeholder="0.7"
              value={draftThreshold}
              onChange={(e) => setDraftThreshold(e.target.value)}
            />
          </>
        )}

        <Button type="button" variant="outline" size="icon" aria-label="Adicionar regra" onClick={addRule}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Palavra:</strong> regex (ex: cancelar). <strong>Conjunto:</strong> todas as palavras devem aparecer (qualquer ordem). <strong>Frase:</strong> interpretação semântica via IA (threshold = confiança mínima para ativar, 0–1).
      </p>
    </div>
  );
}
