# Dashboard Redesign — MDEK Digital (Agentes de IA)

## Visão Geral

Redesign completo do dashboard do sistema de Agentes de IA em WhatsApp. Objetivo: transformar a interface atual (fundo branco, tema shadcn/ui padrão) em um produto premium dark mode com identidade visual forte da marca MDEK Digital — azul elétrico + laranja fogo + cinza escuro profundo.

O produto atende tanto uso interno quanto clientes SaaS (white-label), exigindo nível de acabamento de produto pago.

## Decisões de Design

| Aspecto | Decisão |
|---------|---------|
| Tema | Dark mode exclusivo |
| Paleta | Azul elétrico + âmbar fogo + cinza escuro |
| Tipografia | Geist Sans + Geist Mono |
| Sidebar | Colapsável por hover (64px → 240px) |
| Referência de estilo | Intercom/Chatwoot — foco em comunicação |
| Accent CTA | Âmbar (único botão primário âmbar, diferencia dos azuis) |

---

## Design Tokens — CSS Variables

### Backgrounds

```css
--bg-base:      #0F1219;   /* fundo body/page — mais escuro */
--bg-surface:   #1A1F2E;   /* cards, painéis — cor do logo */
--bg-elevated:  #222840;   /* dropdowns, modais, hover */
--bg-subtle:    #2A3050;   /* inputs, áreas secundárias */
```

### Azul Elétrico (cor primária)

```css
--blue-500:   #2563EB;
--blue-400:   #3B82F6;
--blue-300:   #60A5FA;
--blue-glow:  rgba(37, 99, 235, 0.15);
```

### Laranja Fogo (accent — pontual)

```css
--amber-500:  #F59E0B;
--amber-400:  #FBBF24;
--amber-glow: rgba(245, 158, 11, 0.12);
```

### Texto & Bordas

```css
--text-primary:   #F1F5F9;
--text-secondary: #94A3B8;
--text-muted:     #475569;
--border:         rgba(255, 255, 255, 0.06);
--border-active:  rgba(37, 99, 235, 0.30);
```

### Semânticas

```css
--success: #10B981;
--warning: #F59E0B;   /* mesmo amber — consistência */
--error:   #EF4444;
--info:    #3B82F6;   /* mesmo blue-400 */
```

---

## Tipografia

**Fonte principal:** Geist Sans (open source, Vercel)
**Fonte mono:** Geist Mono — IDs, model names, tokens, logs

### Escala

| Token | Tamanho | Line-height | Uso |
|-------|---------|-------------|-----|
| text-xs | 11px | 1.4 | badges, labels de input |
| text-sm | 13px | 1.5 | corpo, tabelas |
| text-base | 15px | 1.6 | parágrafo padrão |
| text-lg | 17px | 1.5 | subtítulos de seção |
| text-xl | 20px | 1.4 | títulos de página |
| text-2xl | 24px | 1.3 | headings principais |
| text-3xl | 30px | 1.2 | métricas, números grandes |

### Pesos

- `400` Regular → corpo, descrições
- `500` Medium → labels, navegação
- `600` Semibold → títulos de cards
- `700` Bold → headings, números de métrica

### Regras

- Labels de campo: `text-xs font-medium uppercase tracking-wide text-secondary`
- Títulos de página: `text-xl font-semibold text-primary`
- Números de métrica: `text-3xl font-bold text-primary`
- Nomes de model: `font-mono text-xs text-secondary`

---

## Layout Geral

```
┌─────────────────────────────────────────────┐
│  [sidebar]  │  [header 56px]                │
│             │─────────────────────────────  │
│  64px→240px │  [conteúdo principal]          │
│  hover      │                               │
└─────────────────────────────────────────────┘
```

### Sidebar

- Recolhida: `64px` — ícones centralizados
- Expandida: `240px` — ícone + label
- Expansão: hover, transição `200ms ease`
- Fundo: `--bg-surface`, borda direita `1px solid --border`
- Logo: ícone quando recolhida / logo completo quando expandida
- Item ativo: `background: --blue-glow`, `border-left: 3px solid --blue-400`, `color: --blue-300`
- Ícones: `20px`, cor `--text-secondary` em repouso

### Header

- Altura: `56px`
- Fundo: `--bg-base`, borda inferior `1px solid --border`
- Esquerda: breadcrumb da página
- Direita: badge da organização + avatar do usuário

---

## Componentes

### Botões

**Primário (CTA) — âmbar:**
- `background: --amber-500; color: #0F1219; font-weight: 600`
- Hover: `background: --amber-400` + `box-shadow: 0 0 12px --amber-glow`
- Usado apenas para a ação principal da página

**Secundário — azul:**
- `background: --blue-500; color: white`
- Hover: `background: --blue-400`

**Ghost:**
- `background: transparent; border: 1px solid --border; color: --text-secondary`
- Hover: `background: --bg-elevated`

### Cards

- `background: --bg-surface`
- `border: 1px solid --border`
- `border-radius: 12px` (grandes) / `8px` (inputs, badges)
- Hover: borda `--border-active`, `box-shadow: 0 0 0 1px --blue-glow`

### Inputs

- `background: --bg-subtle; border: 1px solid --border`
- Focus: `border-color: --blue-400; box-shadow: 0 0 0 3px --blue-glow`
- Placeholder: `color: --text-muted`

### Badges de Status

- Conectado/Online: ponto `#10B981` pulsante
- Desconectado: ponto `--text-muted`
- Não lido: badge `--amber-500` com número
- Takeover humano: badge `--blue-400` com ícone de pessoa

### Tabelas / Listas

- Header: `text-xs uppercase tracking-wide color: --text-muted`
- Row hover: `background: --bg-elevated`
- Row selecionada: `border-left: 3px solid --blue-400; background: --blue-glow`

### Role Badges (Team)

- `owner`: fundo âmbar, texto escuro
- `admin`: fundo azul, texto branco
- `agent`: ghost com borda

---

## Inbox — Layout Detalhado

Página de maior complexidade — 3 colunas fixas.

```
┌──────────┬───────────────────────────┬─────────────┐
│  LISTA   │     CHAT CENTRAL          │  PAINEL     │
│  280px   │     flex-1                │  300px      │
│          │                           │             │
│ busca    │  header conversa          │  contato    │
│ tabs     │  ─────────────────────    │  atribuição │
│ conv #1  │  mensagens (scroll)       │  tags       │
│ conv #2  │  ─────────────────────    │  notas      │
│ conv #3  │  input + toolbar          │  métricas   │
└──────────┴───────────────────────────┴─────────────┘
```

### Coluna Esquerda — Lista

- Busca: `bg-subtle`, ícone lupa `text-muted`
- Tabs: `Todas · Abertas · Aguardando · Resolvidas` — underline `--blue-400` na ativa
- Card de conversa:
  - Avatar circular com inicial do contato
  - Nome `font-medium` + telefone `text-xs text-muted`
  - Preview truncado 1 linha
  - Timestamp `text-xs text-muted` no canto direito
  - Badge âmbar com contagem de não lidas
  - Indicador de takeover: ícone pessoa azul
  - Ativo: `background: --bg-elevated; border-left: 3px solid --blue-400`

### Coluna Central — Chat

**Header:**
- Avatar + nome + telefone
- Status badge
- Botões: `Assumir` (azul) · `Resolver` (ghost) · `Atribuir` (ghost)
- Em takeover: banner âmbar `"Você está atendendo esta conversa"` + `Devolver ao Agente`

**Mensagens:**
- Contato: `background: --bg-elevated`, radius `12px 12px 12px 2px`, esquerda
- Agente IA: `background: --blue-glow; border: 1px solid --border-active`, radius `12px 12px 2px 12px`, direita
- Humano: âmbar sutil, direita — diferencia visualmente do agente
- Sistema: texto centralizado `text-xs text-muted`
- Metadata IA: `text-xs text-muted` abaixo da bolha (modelo, tokens, latência em `font-mono`)

**Input:**
- `background: --bg-surface; border-top: 1px solid --border`
- Textarea expansível
- Toolbar: emoji · anexo · nota interna (toggle)
- Enviar: botão âmbar com ícone

### Coluna Direita — Painel

- Seções separadas por `border-bottom: 1px solid --border`
- Contato: avatar, nome, telefone, link para histórico
- Atribuição: dropdown com avatares dos atendentes
- Tags: chips com `+` para adicionar
- Notas: mini editor + lista cronológica com avatar do autor
- Métricas: cards compactos com números grandes `text-3xl font-bold`

---

## Agentes

### Lista

- Grid 3 colunas, cards com `border-radius: 12px`
- Ícone de robô em `--blue-400`
- Nome `font-semibold` + model badge `font-mono text-xs`
- Status ativo: ponto verde pulsante
- Card "Novo Agente": borda `dashed`, ghost
- Hover: borda `--border-active`, glow azul

### Edição

- Abas: `Configuração · Base de Conhecimento · FAQs · Histórico`
- System prompt: textarea `font-mono`, `background: --bg-subtle`, contador de tokens
- Temperature / max_tokens: sliders estilizados em azul
- Dropzone de documentos: borda `dashed --amber-500`
- Lista de docs: status badge (`processando` âmbar / `pronto` verde / `erro` vermelho)

---

## Instâncias (Evolution API)

- Tabela: `Instância · Telefone · Status · Agente · Ações`
- Conectado: ponto verde
- Desconectado: ponto vermelho + botão `Reconectar`
- Conectando: ponto âmbar pulsante + QR Code expandível inline
- QR Code: modal `background: --bg-surface`, borda azul, countdown de expiração

---

## Team

- Tabela: avatar + nome + email + role badge + dropdown de troca
- Role badges: `owner` âmbar / `admin` azul / `agent` ghost
- Botão `Convidar Membro`: CTA âmbar, topo direito
- Convites pendentes: cards com borda `dashed`, email + role + expiração + cancelar

---

## Settings

Seções separadas por divider:

1. **Organização** — nome, slug, plano (badge âmbar se premium)
2. **API Keys LLM** — campos mascarados por provider, botão `Revelar / Salvar`, badge `Configurada` verde / `Não configurada` muted
3. **Webhook** — URL copiável com botão copy
4. **Danger Zone** — borda `1px solid --error` sutil, ações destrutivas

---

## Implementação

### Arquivos a modificar

| Arquivo | O que muda |
|---------|-----------|
| `apps/web/src/app/globals.css` | Todos os CSS tokens (dark mode padrão) |
| `apps/web/tailwind.config.ts` | Extend com tokens customizados |
| `apps/web/src/app/layout.tsx` | Import Geist Sans + Geist Mono |
| `apps/web/src/components/layout/app-sidebar.tsx` | Sidebar colapsável por hover |
| `apps/web/src/components/layout/user-nav.tsx` | Estilo dark |
| `apps/web/src/app/(dashboard)/layout.tsx` | Header redesenhado |
| Todos os componentes de página | Aplicar tokens novos |

### Ordem de implementação

1. Tokens CSS + Tailwind config + fontes (base de tudo)
2. Sidebar colapsável
3. Header + layout base
4. Inbox (mais complexo, mais prioritário)
5. Agentes (lista + edição)
6. Instâncias
7. Team + Settings
