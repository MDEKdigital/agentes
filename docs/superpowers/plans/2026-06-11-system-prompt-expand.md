# System Prompt Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar botão de toggle inline no campo System Prompt do formulário de agentes para expandir/recolher a área de edição.

**Architecture:** Estado local `isExpanded` (`useState`) dentro de `AgentForm` controla o `rows` do textarea entre 8 (recolhido) e 24 (expandido). Botão ghost com ícones `Maximize2`/`Minimize2` do lucide-react posicionado no lado direito do label.

**Tech Stack:** React (useState), lucide-react, shadcn/ui Button, Next.js 15

---

### Task 1: Adicionar toggle de expansão ao System Prompt

**Files:**
- Modify: `apps/web/src/components/agents/agent-form.tsx`

- [ ] **Step 1: Adicionar import de useState e ícones**

No topo do arquivo `apps/web/src/components/agents/agent-form.tsx`, adicionar `useState` ao import do React e os ícones ao import do lucide-react:

```tsx
import { useState } from "react";
```

E adicionar `Maximize2, Minimize2` ao import existente do lucide-react. Se não houver import do lucide-react, adicionar:

```tsx
import { Maximize2, Minimize2 } from "lucide-react";
```

- [ ] **Step 2: Declarar estado isExpanded dentro do componente**

Dentro de `AgentForm`, logo após a declaração de `provider`:

```tsx
const [isExpanded, setIsExpanded] = useState(false);
```

- [ ] **Step 3: Atualizar o label e o textarea do System Prompt**

Localizar o bloco do System Prompt (linhas 78–94 do arquivo atual) e substituir por:

```tsx
<div className="space-y-2">
  <div className="flex items-center justify-between">
    <Label htmlFor="system_prompt">System Prompt</Label>
    <button
      type="button"
      onClick={() => setIsExpanded((prev) => !prev)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {isExpanded ? (
        <>
          <Minimize2 className="h-3.5 w-3.5" />
          Recolher
        </>
      ) : (
        <>
          <Maximize2 className="h-3.5 w-3.5" />
          Expandir
        </>
      )}
    </button>
  </div>
  <Textarea
    id="system_prompt"
    {...form.register("system_prompt")}
    placeholder="Você é um assistente de suporte..."
    rows={isExpanded ? 24 : 8}
    className="overflow-y-auto"
  />
  <p className="text-xs text-muted-foreground text-right">
    {(form.watch("system_prompt") ?? "").length}/50000
  </p>
  {form.formState.errors.system_prompt && (
    <p className="text-sm text-destructive">
      {form.formState.errors.system_prompt.message}
    </p>
  )}
</div>
```

- [ ] **Step 4: Verificar no browser**

Iniciar o dev server e abrir `/agentes` → criar ou editar um agente:

```bash
pnpm dev
```

Verificar:
- Campo System Prompt aparece com 8 linhas por padrão
- Clicar "Expandir" aumenta para 24 linhas e exibe ícone `Minimize2` + texto "Recolher"
- Clicar "Recolher" volta para 8 linhas
- Texto digitado não é perdido ao alternar
- Scroll funciona quando o conteúdo ultrapassa as linhas visíveis

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agents/agent-form.tsx
git commit -m "feat: expansão inline do system prompt no formulário de agentes"
```
