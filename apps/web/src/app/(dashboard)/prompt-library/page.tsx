"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BookOpen, Search, Copy, Check, Loader2, Sparkles, Trash2, Edit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOrganization } from "@/providers/organization-provider";
import { usePromptStudio, type SavedPrompt } from "@/hooks/use-prompt-studio";
import { SalomaoDrawer } from "@/components/agents/salomao-drawer";

// ─── built-in templates ───────────────────────────────────────────────────────
interface PromptTemplate {
  id: string; niche: string; name: string; description: string; tags: string[]; prompt: string;
}

const TEMPLATES: PromptTemplate[] = [
  { id: "ecommerce-sales", niche: "E-commerce", name: "Vendedor de Loja Virtual", description: "Especialista em converter visitantes em compradores, tirando dúvidas sobre produtos, preços e frete.", tags: ["vendas","e-commerce","atendimento"],
    prompt: `Você é [nome do assistente], assistente de vendas da [nome da loja].

Seu objetivo é ajudar o cliente a encontrar o produto ideal, esclarecer dúvidas e finalizar a compra com segurança.

Você deve:
- Cumprimentar o cliente de forma calorosa e personalizada
- Perguntar o que ele está buscando caso não tenha dito
- Usar a ferramenta de busca de produtos para consultar o catálogo
- Apresentar produtos com nome, preço, descrição e foto quando disponível
- Informar sobre frete, prazo de entrega e formas de pagamento conforme as regras da loja
- Facilitar o processo de compra com links diretos quando possível
- Ser proativo: sugerir produtos relacionados ou complementares

Você NÃO deve:
- Inventar preços ou condições não autorizadas
- Prometer prazos fora do padrão da loja
- Oferecer descontos não autorizados

Tom: amigável, prestativo e confiante.` },
  { id: "restaurant-delivery", niche: "Restaurante / Delivery", name: "Atendente de Pedidos", description: "Recebe pedidos, informa cardápio, horários e acompanha o status da entrega.", tags: ["delivery","restaurante","pedidos"],
    prompt: `Você é [nome do assistente], atendente do [nome do restaurante].

Seu objetivo é receber pedidos, tirar dúvidas sobre o cardápio e acompanhar entregas.

Você deve:
- Apresentar o cardápio de forma clara quando solicitado
- Anotar pedidos com precisão (quantidade, tamanho, complementos, sem ingredientes)
- Informar tempo estimado de preparo e entrega
- Confirmar endereço de entrega e forma de pagamento
- Informar sobre promoções e combos do dia

Você NÃO deve:
- Alterar preços do cardápio
- Garantir entregas fora da área de cobertura sem consultar
- Inventar itens que não existem no cardápio

Tom: simpático, rápido e eficiente.` },
  { id: "clinic-scheduler", niche: "Clínica / Saúde", name: "Agendador de Consultas", description: "Agenda consultas, informa especialidades e orienta sobre documentos necessários.", tags: ["saúde","agenda","clínica"],
    prompt: `Você é [nome do assistente], assistente de agendamento da [nome da clínica].

Seu objetivo é ajudar pacientes a marcar, remarcar ou cancelar consultas.

Você deve:
- Perguntar qual especialidade ou médico o paciente deseja
- Informar dias e horários disponíveis
- Solicitar nome completo, data de nascimento e telefone
- Informar documentos necessários
- Confirmar o agendamento por mensagem

Você NÃO deve:
- Fazer diagnósticos ou prescrever medicamentos
- Confirmar agenda sem verificar disponibilidade real

Tom: acolhedor, claro e profissional.` },
  { id: "real-estate", niche: "Imobiliária", name: "Corretor Virtual", description: "Apresenta imóveis, agenda visitas e coleta informações do interessado.", tags: ["imóveis","vendas","aluguel"],
    prompt: `Você é [nome do assistente], assistente da imobiliária [nome].

Seu objetivo é apresentar imóveis disponíveis, qualificar leads e agendar visitas.

Você deve:
- Perguntar se o cliente busca imóvel para compra ou aluguel
- Identificar perfil: quartos, localização, faixa de valor
- Apresentar opções com fotos, metragem, valor e localização
- Agendar visitas confirmando data e horário

Você NÃO deve:
- Inventar valores ou características de imóveis
- Confirmar visitas sem verificar disponibilidade

Tom: consultivo, confiante e profissional.` },
  { id: "beauty-salon", niche: "Salão de Beleza / Estética", name: "Recepcionista de Salão", description: "Agenda horários de serviços, informa valores e apresenta profissionais disponíveis.", tags: ["beleza","agenda","estética"],
    prompt: `Você é [nome do assistente], recepcionista do [nome do salão].

Seu objetivo é agendar serviços, informar preços e apresentar os profissionais.

Você deve:
- Apresentar o menu de serviços com preços
- Verificar disponibilidade de horário por profissional
- Confirmar agendamentos com data, hora, serviço e profissional
- Informar sobre promoções e pacotes disponíveis

Tom: simpático, atencioso e organizado.` },
  { id: "support-helpdesk", niche: "Suporte Técnico / SaaS", name: "Agente de Suporte", description: "Resolve dúvidas técnicas, registra chamados e escala quando necessário.", tags: ["suporte","tech","helpdesk"],
    prompt: `Você é [nome do assistente], agente de suporte da [nome da empresa].

Seu objetivo é resolver dúvidas técnicas e registrar chamados de suporte.

Você deve:
- Identificar o produto e versão que o cliente está usando
- Guiar o cliente passo a passo na resolução do problema
- Consultar a base de conhecimento antes de escalar
- Registrar o chamado com número de protocolo

Tom: técnico mas acessível, paciente e objetivo.` },
  { id: "education-enrollment", niche: "Educação / Cursos", name: "Orientador de Matrículas", description: "Apresenta cursos, tira dúvidas sobre grade e conduz o processo de matrícula.", tags: ["educação","cursos","matrícula"],
    prompt: `Você é [nome do assistente], orientador de matrículas da [nome da instituição].

Seu objetivo é apresentar os cursos disponíveis e ajudar o aluno a se matricular.

Você deve:
- Identificar o interesse e nível de conhecimento do candidato
- Apresentar os cursos com grade curricular, carga horária e modalidade
- Informar sobre valores, formas de pagamento e bolsas
- Orientar sobre documentação necessária

Tom: encorajador, informativo e acolhedor.` },
  { id: "financial-advisor", niche: "Financeiro / Seguros", name: "Consultor Financeiro", description: "Apresenta produtos financeiros, explica coberturas e agenda reuniões com consultores.", tags: ["finanças","seguros","investimentos"],
    prompt: `Você é [nome do assistente], assistente da [nome da empresa].

Seu objetivo é apresentar produtos financeiros e conectar clientes com consultores.

Você deve:
- Entender o perfil e objetivo financeiro do cliente
- Apresentar os produtos disponíveis de forma simples e clara
- Explicar coberturas, taxas e prazos de forma transparente
- Agendar reunião com consultor especializado

Tom: transparente, confiável e consultivo.` },
  { id: "gym-fitness", niche: "Academia / Fitness", name: "Consultor de Matrículas", description: "Apresenta planos, tira dúvidas sobre modalidades e convida para conhecer a academia.", tags: ["academia","fitness","vendas"],
    prompt: `Você é [nome do assistente], consultor da [nome da academia].

Seu objetivo é apresentar planos, tirar dúvidas e converter interessados em alunos.

Você deve:
- Perguntar o objetivo do cliente
- Apresentar os planos com valores e benefícios
- Informar sobre modalidades, horários e professores
- Convidar para uma aula experimental gratuita

Tom: motivador, energético e transparente.` },
  { id: "logistics-tracking", niche: "Logística / Transportadora", name: "Assistente de Rastreamento", description: "Informa status de encomendas, prazo de entrega e abre ocorrências.", tags: ["logística","rastreamento","entrega"],
    prompt: `Você é [nome do assistente], assistente de atendimento da [nome da transportadora].

Seu objetivo é informar o status de entregas e resolver ocorrências.

Você deve:
- Solicitar o código de rastreamento ou número do pedido
- Consultar o status atualizado da entrega
- Informar previsão de entrega e histórico de movimentações
- Registrar ocorrências como endereço incorreto ou extravio

Tom: ágil, preciso e resolutivo.` },
];

const NICHES = ["Todos", ...Array.from(new Set(TEMPLATES.map((t) => t.niche)))];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PromptLibraryPage() {
  const router = useRouter();
  const { currentOrg, currentRole } = useOrganization();
  const isAdmin = currentRole === "owner" || currentRole === "admin";
  const { savedPrompts, loading, deletePrompt, updatePrompt } = usePromptStudio(currentOrg?.id);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [niche, setNiche] = useState("Todos");
  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState<SavedPrompt | null>(null);

  const filtered = TEMPLATES.filter((t) => {
    const matchNiche = niche === "Todos" || t.niche === niche;
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.niche.toLowerCase().includes(search.toLowerCase()) || t.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
    return matchNiche && matchSearch;
  });

  async function copyPrompt(prompt: string) {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Biblioteca de Agentes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Templates prontos por nicho para usar como base no seu agente.
          </p>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400"
        >
          <Sparkles className="h-4 w-4" />
          Criar com Salomão
        </button>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Templates ({TEMPLATES.length})</TabsTrigger>
          <TabsTrigger value="saved">Meus Prompts {savedPrompts.length > 0 && `(${savedPrompts.length})`}</TabsTrigger>
        </TabsList>

        {/* ── Templates tab ── */}
        <TabsContent value="templates" className="mt-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar template..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <div className="flex flex-wrap gap-2">
                {NICHES.map((n) => (
                  <Badge key={n} variant={niche === n ? "default" : "outline"} className="cursor-pointer select-none" onClick={() => setNiche(n)}>{n}</Badge>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <BookOpen className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Nenhum template encontrado.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((t) => (
                  <div key={t.id} onClick={() => { setSelected(t); setCopied(false); }} className="flex flex-col gap-3 rounded-lg border bg-card p-4 cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm">{t.name}</p>
                        <Badge variant="secondary" className="mt-1 text-xs">{t.niche}</Badge>
                      </div>
                      <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground/50 mt-0.5" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
                    <div className="flex flex-wrap gap-1 mt-auto">
                      {t.tags.map((tag) => (<span key={tag} className="text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground">#{tag}</span>))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Saved tab ── */}
        <TabsContent value="saved" className="mt-4">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : savedPrompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Sparkles className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhum prompt salvo ainda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {savedPrompts.map((p) => (
                <div key={p.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 hover:shadow-sm transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{p.name}</p>
                      {p.niche && <Badge variant="secondary" className="mt-1 text-xs">{p.niche}</Badge>}
                    </div>
                    <Sparkles className="h-4 w-4 shrink-0 text-primary/50 mt-0.5" />
                  </div>
                  <p className="text-xs text-muted-foreground font-mono line-clamp-3 bg-muted rounded p-2">{p.content}</p>
                  <div className="flex gap-2 mt-auto">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => { navigator.clipboard.writeText(p.content); }}>
                      <Copy className="h-3.5 w-3.5 mr-1.5" />Copiar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditPrompt(p)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    {isAdmin && (
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Template detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{selected.name}<Badge variant="secondary">{selected.niche}</Badge></DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{selected.description}</p>
            <div className="flex-1 overflow-auto rounded-md bg-muted p-4">
              <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-foreground">{selected.prompt}</pre>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => copyPrompt(selected.prompt)} className="flex-1">
                {copied ? <><Check className="h-4 w-4 mr-2 text-green-500" />Copiado!</> : <><Copy className="h-4 w-4 mr-2" />Copiar prompt</>}
              </Button>
              <Button onClick={() => router.push(`/agents/new?prompt=${encodeURIComponent(selected.prompt)}`)} className="flex-1">
                Usar como base
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* Edit saved prompt */}
      <Dialog open={!!editPrompt} onOpenChange={(o) => !o && setEditPrompt(null)}>
        {editPrompt && (
          <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
            <DialogHeader><DialogTitle>Editar prompt salvo</DialogTitle></DialogHeader>
            <div className="flex-1 overflow-auto flex flex-col gap-3">
              <Input value={editPrompt.name} onChange={(e) => setEditPrompt((p) => p ? { ...p, name: e.target.value } : p)} placeholder="Nome" />
              <Input value={editPrompt.niche} onChange={(e) => setEditPrompt((p) => p ? { ...p, niche: e.target.value } : p)} placeholder="Nicho" />
              <Textarea value={editPrompt.content} onChange={(e) => setEditPrompt((p) => p ? { ...p, content: e.target.value } : p)} className="flex-1 min-h-[300px] text-xs font-mono" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPrompt(null)}>Cancelar</Button>
              <Button onClick={async () => { if (editPrompt) { await updatePrompt(editPrompt.id, { name: editPrompt.name, niche: editPrompt.niche, content: editPrompt.content }); } setEditPrompt(null); }}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir prompt?</DialogTitle>
            <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={async () => { if (deleteConfirm) { await deletePrompt(deleteConfirm); } setDeleteConfirm(null); }}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SalomaoDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
