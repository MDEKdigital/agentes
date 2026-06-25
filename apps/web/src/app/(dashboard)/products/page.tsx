"use client";

import { useState, useRef } from "react";
import { useOrganization } from "@/providers/organization-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Package, Plus, Search, Trash2, Edit2, ImagePlus, Loader2, Tag, Layers } from "lucide-react";
import { useProducts } from "@/hooks/use-products";

export default function ProductsPage() {
  const { currentOrg } = useOrganization();
  const { products, loading, createProduct, updateProduct, deleteProduct, uploadPhoto } = useProducts(currentOrg?.id);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("Todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  const [form, setForm] = useState({ name: "", category: "", description: "", price: "", stock_quantity: "" });
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadForId = useRef<string | null>(null);

  // All unique categories
  const categories = ["Todos", ...Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort()];

  // Filter by search and category
  const filtered = products.filter((p) => {
    const matchCat = filterCategory === "Todos" || p.category === filterCategory;
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  // Group by category
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, p) => {
    const cat = p.category || "Sem categoria";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort();

  function openCreate() {
    setEditing(null);
    setForm({ name: "", category: "", description: "", price: "", stock_quantity: "" });
    setDialogOpen(true);
  }

  function openEdit(p: (typeof products)[0]) {
    setEditing({ id: p.id });
    setForm({
      name: p.name,
      category: p.category ?? "",
      description: p.description ?? "",
      price: p.price?.toString() ?? "",
      stock_quantity: p.stock_quantity?.toString() ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !currentOrg) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        price: form.price ? parseFloat(form.price) : undefined,
        stock_quantity: form.stock_quantity ? parseInt(form.stock_quantity) : undefined,
      };
      if (editing) {
        await updateProduct(editing.id, payload);
      } else {
        await createProduct(payload);
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function triggerPhotoUpload(productId: string) {
    uploadForId.current = productId;
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = uploadForId.current;
    if (!file || !id) return;
    e.target.value = "";
    setUploadingId(id);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        await uploadPhoto(id, base64, file.type);
      } finally {
        setUploadingId(null);
      }
    };
    reader.readAsDataURL(file);
  }

  if (!currentOrg) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Catálogo de Produtos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie produtos por tipo. Os agentes consultam este catálogo durante conversas.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Produto
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Badge
                key={c}
                variant={filterCategory === c ? "default" : "outline"}
                className="cursor-pointer select-none"
                onClick={() => setFilterCategory(c)}
              >
                {c}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <Package className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {search || filterCategory !== "Todos" ? "Nenhum produto encontrado." : "Nenhum produto cadastrado ainda."}
          </p>
          {!search && filterCategory === "Todos" && (
            <Button variant="outline" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar produto
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groupKeys.map((cat) => (
            <section key={cat}>
              {/* Category header */}
              <div className="flex items-center gap-2 mb-4">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{cat}</h2>
                <span className="text-xs text-muted-foreground">({grouped[cat].length})</span>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {grouped[cat].map((product) => (
                  <div
                    key={product.id}
                    className="group relative flex flex-col rounded-lg border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    {/* Photo */}
                    <div className="relative aspect-square bg-muted flex items-center justify-center overflow-hidden">
                      {product.photo_url ? (
                        <img
                          src={`${product.photo_url}?w=400&q=80`}
                          alt={product.name}
                          className="object-cover w-full h-full"
                          loading="lazy"
                        />
                      ) : (
                        <Package className="h-12 w-12 text-muted-foreground/30" />
                      )}
                      {uploadingId === product.id && (
                        <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      )}
                      <button
                        onClick={() => triggerPhotoUpload(product.id)}
                        className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow"
                        title="Alterar foto"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                      </button>
                      {/* Stock badge */}
                      {product.stock_quantity != null && (
                        <div className={`absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${product.stock_quantity === 0 ? "bg-destructive text-destructive-foreground" : "bg-background/80 text-foreground"}`}>
                          {product.stock_quantity === 0 ? "Esgotado" : `${product.stock_quantity} un.`}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex flex-col gap-1 p-3 flex-1">
                      <p className="font-medium text-sm leading-tight line-clamp-2">{product.name}</p>
                      {product.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>
                      )}
                      {product.price != null && (
                        <Badge variant="secondary" className="w-fit text-xs mt-auto">
                          R$ {Number(product.price).toFixed(2)}
                        </Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex border-t">
                      <button
                        onClick={() => openEdit(product)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Editar
                      </button>
                      <div className="w-px bg-border" />
                      <button
                        onClick={() => setDeleteId(product.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label>Nome do produto *</Label>
              <Input
                placeholder="Ex: Whey Protein Sabor Morango"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Tipo / Categoria *
              </Label>
              <Input
                placeholder="Ex: Suplementos, Roupas, Calçados, Eletrônicos..."
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Produtos com o mesmo tipo ficam agrupados na tela.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Preço (R$)</Label>
                <Input
                  type="number"
                  placeholder="0,00"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Quantidade em estoque</Label>
                <Input
                  type="number"
                  placeholder="Ex: 50"
                  min="0"
                  step="1"
                  value={form.stock_quantity}
                  onChange={(e) => setForm((f) => ({ ...f, stock_quantity: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Descrição</Label>
              <Textarea
                placeholder="Detalhes, sabores, tamanhos, especificações..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={!form.name.trim() || saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editing ? "Salvar alterações" : "Criar produto"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir produto?</DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita. A foto também será removida do armazenamento.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deleteId) await deleteProduct(deleteId);
                setDeleteId(null);
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
