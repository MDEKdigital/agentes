# Multi-Tenant Security Architecture

## Visão Geral

Este projeto é uma plataforma SaaS multi-tenant. Cada organização é completamente isolada das demais. Este documento descreve o modelo de segurança adotado, o padrão arquitetural vigente e o checklist obrigatório para novas rotas.

---

## Modelo de Isolamento

O isolamento multi-tenant é aplicado em duas camadas complementares:

| Camada | Onde | Responsabilidade |
|--------|------|-----------------|
| **Membership check** | Rotas da API (Fastify) | Proteção principal — verifica se o usuário autenticado pertence à organização |
| **RLS (Row Level Security)** | Banco de dados (Supabase) | Defesa em profundidade — protege acesso direto ao banco |

---

## Por que `getAdminClient()` e não RLS como proteção principal

A API usa `getAdminClient()` em todas as rotas. Este cliente utiliza a `SUPABASE_SERVICE_ROLE_KEY`, que **bypassa RLS** completamente.

**Motivação arquitetural:**
- O RLS é avaliado por linha a cada query, adicionando overhead em tabelas grandes.
- A service role key permite queries complexas (JOINs, aggregations) sem restrições de RLS.
- A proteção é feita explicitamente no nível da rota, onde o contexto do usuário já está disponível via JWT.

**Consequência importante:**
> Qualquer rota que esqueça o `membership check` ficará **desprotegida**. O RLS não salvará esse caso porque o admin client o bypassa.

O RLS protege apenas:
- Acesso direto ao banco (Supabase Studio, `psql`, clientes externos com `anon`/`authenticated` key)
- Subscriptions Realtime (filtradas pelo JWT do usuário)
- Workers que eventualmente usem user-scoped clients

---

## Roles e Permissões

| Role | Pode fazer |
|------|-----------|
| `owner` | Tudo — incluindo deletar organização e instâncias |
| `admin` | Gerenciar instâncias, agentes, knowledge, remarketing — exceto delete de org/instância |
| `agent` | Leitura de conversas, agentes, instâncias — sem acesso a ações administrativas |

### Restrições por role nas rotas

```
role === "owner"     → DELETE /organizations/:id, DELETE /instances/:id
role !== "agent"     → POST/PATCH/DELETE em instâncias, knowledge, FAQs, remarketing
membership exists    → GET em qualquer recurso da org
```

---

## Padrão de Membership Check

Toda rota que acessa dados de uma organização **deve** verificar o membership antes de qualquer operação no banco.

### Padrão para rotas com `:organizationId` no path

```ts
app.get("/organizations/:organizationId/resource", async (request, reply) => {
  const { organizationId } = request.params;

  const membership = request.user.memberships.find(
    (m) => m.organization_id === organizationId
    // adicionar && m.role !== "agent" se a ação for administrativa
  );
  if (!membership) return reply.status(403).send({ error: "Acesso negado" });

  const db = getAdminClient();
  // queries sempre filtradas por organizationId
  const data = await getResourceByOrg(db, organizationId);
  return data;
});
```

### Padrão para rotas com `:resourceId` no path (sem organizationId explícito)

```ts
app.delete("/resource/:resourceId", async (request, reply) => {
  const db = getAdminClient();

  // 1. Carregar o recurso para obter organization_id
  const resource = await getResourceById(db, request.params.resourceId);
  if (!resource) return reply.status(404).send({ error: "Não encontrado" });

  // 2. Verificar membership na org do recurso
  const membership = request.user.memberships.find(
    (m) => m.organization_id === resource.organization_id && m.role !== "agent"
  );
  // Retornar 404 (não 403) para evitar information disclosure
  if (!membership) return reply.status(404).send({ error: "Não encontrado" });

  // 3. Deletar sempre passando organizationId como filtro extra
  await deleteResource(db, resource.id, resource.organization_id);
  return reply.status(204).send();
});
```

---

## Funções de Delete — Hardening Obrigatório

Toda função de delete no pacote `@aula-agente/database` **deve** receber `organizationId` e aplicá-lo como filtro adicional na query:

```ts
// CORRETO — duplo filtro: id + organization_id
export async function deleteAgent(client: SupabaseClient, id: string, organizationId: string) {
  const { error } = await client
    .from("agents")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId); // ← obrigatório
  if (error) throw error;
}

// INCORRETO — filtro apenas por id permite delete cross-tenant se membership check falhar
export async function deleteAgent(client: SupabaseClient, id: string) {
  const { error } = await client.from("agents").delete().eq("id", id);
  if (error) throw error;
}
```

---

## RLS — Tabelas com Policies Ativas

Todas as tabelas em `public` têm RLS habilitado. As policies usam a função `get_user_org_ids()`:

```sql
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF uuid AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### Tabelas e migrations

| Tabela | RLS Habilitado | Policies |
|--------|---------------|----------|
| `organizations` | 00008 | SELECT, INSERT, UPDATE |
| `organization_members` | 00008 | SELECT, INSERT, DELETE |
| `agents` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `evolution_instances` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `knowledge_documents` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `knowledge_chunks` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `knowledge_faqs` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `conversations` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `messages` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `conversation_notes` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `conversation_metrics` | 00008 | SELECT, INSERT, UPDATE, DELETE |
| `remarketing_flows` | 00023 | SELECT, INSERT, UPDATE, DELETE (00027) |
| `remarketing_enrollments` | 00023 | SELECT, INSERT, UPDATE, DELETE (00027) |
| `remarketing_steps` | 00023 | SELECT, INSERT, UPDATE, DELETE via EXISTS (00027) |

### `remarketing_steps` — acesso via JOIN (sem `organization_id` direto)

```sql
CREATE POLICY "remarketing_steps_select" ON remarketing_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM remarketing_flows rf
      WHERE rf.id = remarketing_steps.flow_id
        AND rf.organization_id IN (SELECT get_user_org_ids())
    )
  );
```

---

## Workers (BullMQ)

Workers usam `getAdminClient()` (service role) para acessar dados — RLS não se aplica. Isso é intencional para jobs de background.

**Responsabilidade de isolamento nos workers:** garantida pelo payload do job, que contém IDs validados pela API no momento do enfileiramento.

**Risco residual:** um job forjado diretamente no Redis com IDs de outro tenant seria processado. Mitigado pelo Redis não estar exposto externamente.

---

## Checklist para Novas Rotas

Antes de fazer merge de qualquer nova rota, verificar:

- [ ] A rota aplica `authMiddleware` (ou está dentro de um plugin que já o faz)
- [ ] O `membership check` está presente e filtra por `organization_id` correto
- [ ] A role (`owner`, `admin`, `agent`) foi considerada para a ação
- [ ] Nenhuma query usa `getAdminClient()` sem um membership check anterior na mesma rota
- [ ] Funções de delete recebem e aplicam `organizationId` como filtro
- [ ] Rotas que carregam resource por ID verificam `resource.organization_id` no membership
- [ ] Erros retornam 404 (não 403) quando o objetivo é evitar information disclosure
- [ ] A nova tabela (se criada) tem RLS habilitado e policies definidas

---

## Referências

- `supabase/migrations/00008_rls_policies.sql` — RLS base e `get_user_org_ids()`
- `supabase/migrations/00023_remarketing.sql` — RLS habilitado nas tabelas de remarketing
- `supabase/migrations/00027_remarketing_rls.sql` — Policies das tabelas de remarketing
- `apps/api/src/middleware/auth.ts` — `authMiddleware` e `request.user.memberships`
- `packages/database/src/queries/` — Funções de acesso ao banco com hardening de organizationId
