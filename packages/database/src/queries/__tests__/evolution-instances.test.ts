import { describe, it, expect, vi } from "vitest";
import { getInstanceById, getInstanceByIdForUser } from "../evolution-instances";

function makeClient({
  returnData = null as unknown,
  captureEq = (_field: string, _val: unknown) => {},
  captureIn = (_field: string, _vals: unknown) => {},
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: returnData, error: null });
  const single = vi.fn().mockResolvedValue({ data: returnData, error: null });
  const inMock = vi.fn().mockImplementation((field: string, vals: unknown) => {
    captureIn(field, vals);
    return { maybeSingle };
  });
  const eqMock = vi.fn().mockImplementation((field: string, val: unknown) => {
    captureEq(field, val);
    return { eq: eqMock, in: inMock, single };
  });
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: eqMock }),
    }),
  };
}

describe("getInstanceById — V2 hardening", () => {
  it("filtra por id E organization_id na mesma query", async () => {
    const captured: Record<string, unknown> = {};
    const client = makeClient({
      captureEq: (f, v) => { captured[f] = v; },
      returnData: { id: "inst-1", organization_id: "org-a" },
    });

    await getInstanceById(client as any, "inst-1", "org-a");

    expect(captured["id"]).toBe("inst-1");
    expect(captured["organization_id"]).toBe("org-a");
  });

  it("retorna o dado quando org bate", async () => {
    const fixture = { id: "inst-1", organization_id: "org-a", instance_name: "wa" };
    const client = makeClient({ returnData: fixture });
    const result = await getInstanceById(client as any, "inst-1", "org-a");
    expect(result).toEqual(fixture);
  });
});

describe("getInstanceByIdForUser — V2 hardening", () => {
  it("usa .in() com array de orgIds", async () => {
    let capturedField = "";
    let capturedVals: unknown = [];
    const fixture = { id: "inst-1", organization_id: "org-a" };
    const client = makeClient({
      returnData: fixture,
      captureIn: (f, v) => { capturedField = f; capturedVals = v; },
    });

    await getInstanceByIdForUser(client as any, "inst-1", ["org-a", "org-b"]);

    expect(capturedField).toBe("organization_id");
    expect(capturedVals).toEqual(["org-a", "org-b"]);
  });

  it("retorna null quando instância não pertence a nenhuma org do usuário", async () => {
    const client = makeClient({ returnData: null });
    const result = await getInstanceByIdForUser(client as any, "inst-foreign", ["org-a"]);
    expect(result).toBeNull();
  });

  it("retorna o dado quando org está no array", async () => {
    const fixture = { id: "inst-1", organization_id: "org-a" };
    const client = makeClient({ returnData: fixture });
    const result = await getInstanceByIdForUser(client as any, "inst-1", ["org-a"]);
    expect(result).toEqual(fixture);
  });
});
