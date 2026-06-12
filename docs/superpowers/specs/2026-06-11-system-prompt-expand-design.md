# System Prompt Expand — Design Spec

## Overview

Adicionar um botão de toggle inline ao campo System Prompt no formulário de agentes, permitindo expandir ou recolher a área de edição sem abrir modais ou painéis externos.

## Escopo

Mudança restrita a um único arquivo: `apps/web/src/components/agents/agent-form.tsx`.

## Design

### Estado

```tsx
const [isExpanded, setIsExpanded] = useState(false);
```

Estado local dentro de `AgentForm`. Sem persistência — volta ao estado recolhido ao recarregar a página.

### UI do Label

A linha do label "System Prompt" passa a ser um flex container com `justify-between`:

- **Esquerda:** `<Label htmlFor="system_prompt">System Prompt</Label>`
- **Direita:** botão ghost pequeno com ícone `Maximize2` (recolhido) ou `Minimize2` (expandido) + texto "Expandir" / "Recolher"

Ícones de `lucide-react`, já disponível no projeto.

### Textarea

```tsx
<Textarea
  id="system_prompt"
  rows={isExpanded ? 24 : 8}
  className="overflow-y-auto"
  ...
/>
```

- Recolhido: `rows={8}` (comportamento atual)
- Expandido: `rows={24}` com scroll vertical habilitado
- O conteúdo digitado não é afetado pela troca de estado

### Comportamento

| Ação | Resultado |
|------|-----------|
| Clicar "Expandir" | textarea passa para 24 linhas |
| Clicar "Recolher" | textarea volta para 8 linhas |
| Digitar texto | não interfere no estado de expansão |
| Recarregar página | volta ao estado recolhido |

## Arquivos Modificados

| Arquivo | Tipo de mudança |
|---------|----------------|
| `apps/web/src/components/agents/agent-form.tsx` | Adicionar `useState`, atualizar markup do label e `rows` do textarea |

## Fora do Escopo

- Animação de transição
- Persistência do estado expandido (localStorage)
- Outros campos do formulário
