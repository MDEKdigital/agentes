"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Product {
  id: string;
  organization_id: string;
  name: string;
  category: string;
  description: string;
  price: number | null;
  stock_quantity: number | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export function useProducts(organizationId: string | undefined) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  const getHeaders = async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    };
  };

  const fetchProducts = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const h = await getHeaders();
      const r = await fetch(`${apiBase}/organizations/${organizationId}/products`, { headers: h });
      const data = await r.json();
      setProducts(data.products ?? []);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  async function createProduct(payload: { name: string; category?: string; description?: string; price?: number; stock_quantity?: number }) {
    const h = await getHeaders();
    const r = await fetch(`${apiBase}/organizations/${organizationId}/products`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error("Erro ao criar produto");
    const product = await r.json();
    setProducts((prev) => [...prev, product].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
    return product as Product;
  }

  async function updateProduct(productId: string, payload: Partial<{ name: string; category: string; description: string; price: number; stock_quantity: number }>) {
    const h = await getHeaders();
    const r = await fetch(`${apiBase}/organizations/${organizationId}/products/${productId}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error("Erro ao atualizar produto");
    const updated = await r.json();
    setProducts((prev) => prev.map((p) => (p.id === productId ? updated : p)));
    return updated as Product;
  }

  async function deleteProduct(productId: string) {
    const h = await getHeaders();
    await fetch(`${apiBase}/organizations/${organizationId}/products/${productId}`, {
      method: "DELETE",
      headers: h,
    });
    setProducts((prev) => prev.filter((p) => p.id !== productId));
  }

  async function uploadPhoto(productId: string, base64: string, mimeType: string) {
    const h = await getHeaders();
    const r = await fetch(`${apiBase}/organizations/${organizationId}/products/${productId}/photo`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ base64, mimeType }),
    });
    if (!r.ok) throw new Error("Erro ao enviar foto");
    const updated = await r.json();
    setProducts((prev) => prev.map((p) => (p.id === productId ? updated : p)));
    return updated as Product;
  }

  return { products, loading, createProduct, updateProduct, deleteProduct, uploadPhoto, refresh: fetchProducts };
}
