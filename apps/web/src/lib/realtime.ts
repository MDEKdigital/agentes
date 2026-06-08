import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

interface UseRealtimeOptions<T> {
  table: string;
  filter?: string;
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  onInsert?: (payload: T) => void;
  onUpdate?: (payload: T) => void;
  onDelete?: (payload: T) => void;
  enabled?: boolean;
}

export function useRealtime<T extends Record<string, unknown>>({
  table,
  filter,
  event = "*",
  onInsert,
  onUpdate,
  onDelete,
  enabled = true,
}: UseRealtimeOptions<T>) {
  // Store callbacks in refs so the subscription effect never needs to re-run
  // when the caller passes new inline arrow functions on each render.
  const onInsertRef = useRef(onInsert);
  const onUpdateRef = useRef(onUpdate);
  const onDeleteRef = useRef(onDelete);

  useEffect(() => { onInsertRef.current = onInsert; }, [onInsert]);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();

    const channelConfig: Record<string, string> = {
      event,
      schema: "public",
      table,
    };

    if (filter) {
      channelConfig.filter = filter;
    }

    const channel = supabase
      .channel(`realtime:${table}:${filter || "all"}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on("postgres_changes" as any, channelConfig, (payload: RealtimePostgresChangesPayload<T>) => {
        if (payload.eventType === "INSERT" && onInsertRef.current) {
          onInsertRef.current(payload.new as T);
        }
        if (payload.eventType === "UPDATE" && onUpdateRef.current) {
          onUpdateRef.current(payload.new as T);
        }
        if (payload.eventType === "DELETE" && onDeleteRef.current) {
          onDeleteRef.current(payload.old as T);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, event, enabled]); // callbacks excluded — accessed via refs
}
