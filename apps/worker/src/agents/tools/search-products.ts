import { tool } from "ai";
import { z } from "zod";
import { getAdminClient, searchProducts } from "@aula-agente/database";

export function createSearchProductsTool(organizationId: string) {
  return tool({
    description: "Busca produtos do catálogo da empresa pelo nome. Use quando o cliente perguntar sobre um produto, preço, disponibilidade ou quiser ver o que a empresa oferece.",
    parameters: z.object({
      query: z.string().describe("Nome ou termo do produto a buscar"),
    }),
    execute: async ({ query }) => {
      try {
        const db = getAdminClient();
        const products = await searchProducts(db, organizationId, query);

        if (products.length === 0) {
          return `<product_search_result>\nNenhum produto encontrado para "${query}".\n</product_search_result>`;
        }

        const list = products.map((p) => {
          const price = p.price != null ? `R$ ${Number(p.price).toFixed(2)}` : "Consultar";
          const category = p.category ? ` [${p.category}]` : "";
          const stock = p.stock_quantity != null ? `\n   Estoque: ${p.stock_quantity} unidades` : "";
          const desc = p.description ? `\n   Descrição: ${p.description}` : "";
          const photo = p.photo_url ? `\n   Foto: ${p.photo_url}` : "";
          return `- ${p.name}${category} | Preço: ${price}${stock}${desc}${photo}`;
        }).join("\n");

        return `<product_search_result>\nProdutos encontrados:\n${list}\n</product_search_result>`;
      } catch {
        return `<product_search_result>\nNão foi possível buscar produtos no momento.\n</product_search_result>`;
      }
    },
  });
}
