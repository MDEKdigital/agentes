"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Send, Sparkles, Copy, Check, ArrowRight, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/providers/organization-provider";
import { useSalomaoStream, type ChatMessage } from "@/hooks/use-salomao-stream";

interface SalomaoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

export function SalomaoDrawer({ isOpen, onClose }: SalomaoDrawerProps) {
  const router = useRouter();
  const { currentOrg } = useOrganization();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [initialized, setInitialized] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  const onChunk = useCallback((text: string) => {
    setStreamingContent((prev) => prev + text);
  }, []);

  const onPromptReady = useCallback((prompt: string) => {
    setGeneratedPrompt(prompt);
  }, []);

  const onDone = useCallback(() => {
    setStreamingContent((prev) => {
      if (prev) {
        const display = prev
          .replace(/<prompt>[\s\S]*?<\/prompt>/gi, "✅ Prompt gerado! Veja ao lado →")
          .trim();
        setMessages((m) => [...m, { role: "assistant", content: display }]);
      }
      return "";
    });
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const onError = useCallback((message: string) => {
    setStreamingContent("");
    setMessages((m) => [
      ...m,
      { role: "assistant", content: `⚠️ ${message}` },
    ]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const { state, send, abort } = useSalomaoStream({
    organizationId: currentOrg?.id,
    onChunk,
    onPromptReady,
    onDone,
    onError,
  });

  const isStreaming = state === "connecting" || state === "streaming";

  useEffect(() => {
    if (!isOpen || initialized || !currentOrg) return;
    setInitialized(true);
    send([]);
  }, [isOpen, initialized, currentOrg, send]);

  useEffect(() => {
    if (!isOpen) {
      abort();
      setMessages([]);
      setStreamingContent("");
      setGeneratedPrompt("");
      setInput("");
      setInitialized(false);
    }
  }, [isOpen, abort]);

  async function handleSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || isStreaming) return;

    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    setStreamingContent("");

    await send(newMessages);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function copyPrompt() {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function useAsPrompt() {
    if (!generatedPrompt) return;
    sessionStorage.setItem("salomao_prompt_draft", generatedPrompt);
    onClose();
    router.push("/agents/new?from=salomao");
  }

  const displayStreamingContent =
    streamingContent
      .replace(/<prompt>[\s\S]*?<\/prompt>/gi, "✅ Prompt gerado! Veja ao lado →")
      .trim();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col bg-card shadow-2xl border-l border-border">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted/30 shrink-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
            S
          </div>
          <div>
            <p className="font-semibold text-sm">Salomão</p>
            <p className="text-[11px] text-muted-foreground">Consultor Oficial de Agentes</p>
          </div>
          <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body: Chat + Preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Chat */}
          <div className="flex flex-col flex-1 min-w-0 border-r border-border">
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {displayStreamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-muted text-foreground">
                    {displayStreamingContent}
                  </div>
                </div>
              )}

              {isStreaming && !displayStreamingContent && <TypingIndicator />}

              {state === "error" && messages.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="text-sm text-muted-foreground">Erro ao conectar. Tente novamente.</p>
                  <Button variant="outline" size="sm" onClick={() => { setInitialized(false); }}>
                    <RefreshCw className="h-4 w-4 mr-2" />Reconectar
                  </Button>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-border p-3 flex gap-2 items-end">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e.target);
                }}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder={isStreaming ? "Salomão está digitando..." : "Responda Salomão... (Enter para enviar)"}
                className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 overflow-y-auto"
                style={{ minHeight: "38px", maxHeight: "200px" }}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => handleSend()}
                disabled={!input.trim() || isStreaming}
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Preview do Prompt */}
          <div className="w-[45%] shrink-0 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30 shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="font-semibold text-sm">Prompt gerado</p>
            </div>

            {generatedPrompt ? (
              <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
                <textarea
                  readOnly
                  value={generatedPrompt}
                  className="flex-1 resize-none rounded-md border border-border bg-muted/40 p-3 text-xs font-mono text-foreground overflow-y-auto focus:outline-none"
                />
                <div className="flex flex-col gap-2 shrink-0">
                  <Button variant="outline" onClick={copyPrompt} className="w-full">
                    {copied ? (
                      <><Check className="h-4 w-4 mr-2 text-green-500" />Copiado!</>
                    ) : (
                      <><Copy className="h-4 w-4 mr-2" />Copiar prompt</>
                    )}
                  </Button>
                  <Button onClick={useAsPrompt} className="w-full">
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Usar este prompt
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Sparkles className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Responda as perguntas do Salomão e o prompt do seu agente aparecerá aqui automaticamente.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
