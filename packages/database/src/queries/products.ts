import type { SupabaseClient } from "@supabase/supabase-js";

export interface Product {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  price: number | null;
  photo_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function getProductsByOrganization(
  client: SupabaseClient,
  organizationId: string
) {
  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data as Product[];
}

export async function getProductById(
  client: SupabaseClient,
  productId: string,
  organizationId: string
) {
  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  return data as Product;
}

export async function createProduct(
  client: SupabaseClient,
  product: Omit<Product, "id" | "created_at" | "updated_at">
) {
  const { data, error } = await client
    .from("products")
    .insert(product)
    .select()
    .single();
  if (error) throw error;
  return data as Product;
}

export async function updateProduct(
  client: SupabaseClient,
  productId: string,
  organizationId: string,
  updates: Partial<Pick<Product, "name" | "description" | "price" | "photo_url">>
) {
  const { data, error } = await client
    .from("products")
    .update(updates)
    .eq("id", productId)
    .eq("organization_id", organizationId)
    .select()
    .single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(
  client: SupabaseClient,
  productId: string,
  organizationId: string
) {
  const { error } = await client
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("organization_id", organizationId);
  if (error) throw error;
}

export async function searchProducts(
  client: SupabaseClient,
  organizationId: string,
  query: string
) {
  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("organization_id", organizationId)
    .ilike("name", `%${query}%`)
    .order("name", { ascending: true })
    .limit(10);
  if (error) throw error;
  return data as Product[];
}
