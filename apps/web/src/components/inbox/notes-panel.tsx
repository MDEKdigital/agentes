"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import type { ConversationNote } from "@aula-agente/shared";

interface NotesPanelProps {
  conversationId: string;
  organizationId: string;
}

export function NotesPanel({ conversationId }: NotesPanelProps) {
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const data = await apiFetch(`/conversations/${conversationId}/notes`);
      setNotes(data.notes || []);
    } catch {
      // silently fail — notes are non-critical
    }
  }, [conversationId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/conversations/${conversationId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: newNote.trim() }),
      });
      setNewNote("");
      await fetchNotes();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar nota");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Nota interna..."
          rows={2}
          className="text-xs bg-muted border-border resize-none"
        />
        <Button
          size="icon"
          onClick={handleAdd}
          disabled={saving || !newNote.trim()}
          className="h-8 w-8 shrink-0 bg-primary hover:bg-blue-electric-400"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2">
        {notes.map((note) => (
          <div
            key={note.id}
            className="rounded-lg border border-amber-fire-500/20 bg-amber-fire-500/5 p-2.5"
          >
            <p className="text-xs text-foreground leading-relaxed">{note.content}</p>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {new Date(note.created_at).toLocaleString("pt-BR")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
