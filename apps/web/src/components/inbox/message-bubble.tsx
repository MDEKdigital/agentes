"use client";

import { useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@aula-agente/shared";

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
    setPlaying(!playing);
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 w-[220px]">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a && a.duration) setProgress(a.currentTime / a.duration);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
      />
      <button
        onClick={toggle}
        className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 hover:bg-primary/30 transition-colors"
      >
        {playing ? <Pause className="h-3.5 w-3.5 text-blue-electric-300" /> : <Play className="h-3.5 w-3.5 text-blue-electric-300 ml-0.5" />}
      </button>
      <div className="flex-1 space-y-1">
        <div
          className="relative h-1.5 w-full rounded-full bg-muted cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            const a = audioRef.current;
            if (a && a.duration) { a.currentTime = ratio * a.duration; setProgress(ratio); }
          }}
        >
          <div className="h-full rounded-full bg-blue-electric-400 transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground">{fmt(progress * duration)} / {fmt(duration)}</p>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isContact = message.role === "contact";
  const isAgent = message.role === "agent";
  const isHuman = message.role === "human_agent";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex", isContact ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[72%] px-3 py-2.5",
          isContact && "rounded-[12px_12px_12px_2px] bg-elevated",
          isAgent && "rounded-[12px_12px_2px_12px] bg-primary/10 border border-primary/25",
          isHuman && "rounded-[12px_12px_2px_12px] bg-amber-fire-500/10 border border-amber-fire-500/25"
        )}
      >
        {(isAgent || isHuman) && (
          <p className={cn(
            "mb-1 text-[10px] font-medium uppercase tracking-wider",
            isAgent ? "text-blue-electric-300" : "text-amber-fire-400"
          )}>
            {isAgent ? "Agente IA" : "Atendente"}
          </p>
        )}

        {message.media_type === "audio" && message.media_url ? (
          <AudioPlayer src={message.media_url} />
        ) : null}

        {message.media_type === "image" && message.media_url ? (
          <img
            src={message.media_url}
            alt="imagem"
            className="max-w-[260px] rounded-md object-cover"
          />
        ) : null}

        {(message.media_type !== "audio" || !message.media_url) &&
          (message.media_type !== "image" || !message.media_url) &&
          message.content && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {message.content}
          </p>
        )}

        <p className={cn(
          "mt-1.5 text-right text-[10px]",
          isContact ? "text-muted-foreground" : "text-muted-foreground/70"
        )}>
          {formatTime(message.created_at)}
        </p>

        {/* Metadata da IA */}
        {isAgent && message.metadata && (
          <p className="mt-1 text-[10px] font-mono text-muted-foreground/50">
            {(message.metadata as { model?: string; tokens_used?: number }).model}
            {(message.metadata as { tokens_used?: number }).tokens_used
              ? ` · ${(message.metadata as { tokens_used: number }).tokens_used} tokens`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
