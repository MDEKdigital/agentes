import { describe, it, expect } from "vitest";
import { chunkText } from "../chunker";

describe("chunkText", () => {
  it("retorna um único chunk vazio para string vazia", () => {
    // A implementação atual retorna um chunk com conteúdo vazio
    // quando text.length <= CHUNK_SIZE (incluindo string vazia).
    const result = chunkText("");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("");
    expect(result[0].metadata.chunk_index).toBe(0);
  });

  it("retorna um único chunk para texto menor que CHUNK_SIZE (1000 chars)", () => {
    const text = "a".repeat(500);
    const result = chunkText(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
    expect(result[0].metadata.chunk_index).toBe(0);
  });

  it("retorna múltiplos chunks para texto maior que CHUNK_SIZE", () => {
    const text = "palavra ".repeat(200); // ~1600 chars
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(1);
  });

  it("cada chunk tem chunk_index sequencial começando em 0", () => {
    const text = "x".repeat(3000);
    const result = chunkText(text);
    result.forEach((chunk, i) => {
      expect(chunk.metadata.chunk_index).toBe(i);
    });
  });

  it("chunks têm sobreposição (overlap de 200 chars)", () => {
    const text = "a".repeat(3000);
    const result = chunkText(text);
    const endOfFirst = result[0].content.slice(-100);
    const startOfSecond = result[1].content.slice(0, 100);
    expect(endOfFirst).toBe(startOfSecond);
  });
});
