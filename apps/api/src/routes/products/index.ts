import type { FastifyInstance } from "fastify";
import {
  getAdminClient,
  getProductsByOrganization,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/heic", "image/heif", "image/gif",
]);

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "image/gif": "gif",
};

export default async function productRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // List products
  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/products",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const products = await getProductsByOrganization(db, organizationId);
      return reply.send({ products });
    }
  );

  // Create product
  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/products",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { name, description, price } = request.body as { name: string; description?: string; price?: number };
      if (!name?.trim()) return reply.status(400).send({ error: "Nome do produto é obrigatório" });

      const db = getAdminClient();
      const product = await createProduct(db, {
        organization_id: organizationId,
        name: name.trim(),
        description: description?.trim() ?? "",
        price: price ?? null,
        photo_url: null,
        metadata: {},
      });
      return reply.status(201).send(product);
    }
  );

  // Update product
  app.patch<{ Params: { organizationId: string; productId: string } }>(
    "/organizations/:organizationId/products/:productId",
    async (request, reply) => {
      const { organizationId, productId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { name, description, price } = request.body as { name?: string; description?: string; price?: number };
      const db = getAdminClient();
      const product = await updateProduct(db, productId, organizationId, {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description.trim() }),
        ...(price !== undefined && { price }),
      });
      return reply.send(product);
    }
  );

  // Delete product
  app.delete<{ Params: { organizationId: string; productId: string } }>(
    "/organizations/:organizationId/products/:productId",
    async (request, reply) => {
      const { organizationId, productId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const existing = await getProductById(db, productId, organizationId);
      // Remove photo from storage if exists
      if (existing.photo_url) {
        const path = existing.photo_url.split("/products/")[1];
        if (path) await db.storage.from("products").remove([path]);
      }
      await deleteProduct(db, productId, organizationId);
      return reply.status(204).send();
    }
  );

  // Upload product photo
  app.post<{ Params: { organizationId: string; productId: string } }>(
    "/organizations/:organizationId/products/:productId/photo",
    async (request, reply) => {
      const { organizationId, productId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { base64, mimeType } = request.body as { base64: string; mimeType: string };
      const mime = mimeType?.toLowerCase().trim();

      if (!base64 || !mime || !ALLOWED_MIME.has(mime)) {
        return reply.status(400).send({ error: "Formato inválido. Use JPEG, PNG, WebP, HEIC ou GIF." });
      }

      // Limit: 10MB decoded
      const byteLength = Math.ceil((base64.length * 3) / 4);
      if (byteLength > 10_485_760) {
        return reply.status(400).send({ error: "Imagem muito grande. Máximo 10MB." });
      }

      const ext = EXT_MAP[mime] ?? "jpg";
      const path = `${organizationId}/${productId}.${ext}`;
      const buffer = Buffer.from(base64, "base64");

      const db = getAdminClient();

      // Remove old photo if exists
      const existing = await getProductById(db, productId, organizationId).catch(() => null);
      if (existing?.photo_url) {
        const oldPath = existing.photo_url.split("/products/")[1];
        if (oldPath) await db.storage.from("products").remove([oldPath]);
      }

      const { error: uploadErr } = await db.storage
        .from("products")
        .upload(path, buffer, { contentType: mime, upsert: true });

      if (uploadErr) return reply.status(500).send({ error: "Falha ao salvar imagem" });

      const { data: urlData } = db.storage.from("products").getPublicUrl(path);
      const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const product = await updateProduct(db, productId, organizationId, { photo_url: urlData.publicUrl });
      return reply.send({ ...product, photo_url: photoUrl });
    }
  );
}
