import { describe, expect, it, vi } from "vitest";

import { shareBattle, type ShareHost } from "./shareBattle";

const file = new File([new Uint8Array([1, 2, 3])], "card.png", { type: "image/png" });
const request = { url: "https://siegemate.pages.dev/#r=1abc", title: "Siegemate", text: "Ivory Kingdom won.", file };

function host(overrides: Partial<ShareHost> = {}): ShareHost & { clipboard: { writeText: ReturnType<typeof vi.fn> } } {
  return { clipboard: { writeText: vi.fn(async () => undefined) }, ...overrides } as never;
}

describe("shareBattle", () => {
  it("shares the card and the link where files can be shared", async () => {
    const share = vi.fn(async () => undefined);
    const save = vi.fn();
    const outcome = await shareBattle(request, host({ share, canShare: () => true }), save);
    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [file], url: request.url }));
    expect((share.mock.calls[0] as unknown as [ShareData])[0].text).toContain(request.url);
    expect(save).not.toHaveBeenCalled();
  });

  it("shares the link alone where files cannot be shared", async () => {
    const share = vi.fn(async () => undefined);
    const outcome = await shareBattle(request, host({ share, canShare: () => false }), vi.fn());
    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: request.title, text: request.text, url: request.url });
  });

  it("does nothing more when the player closes the share sheet", async () => {
    const share = vi.fn(async () => {
      throw Object.assign(new Error("closed"), { name: "AbortError" });
    });
    const save = vi.fn();
    const h = host({ share, canShare: () => true });
    expect(await shareBattle(request, h, save)).toBe("cancelled");
    expect(save).not.toHaveBeenCalled();
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("saves the card and copies the link without a share sheet, or when sharing is refused", async () => {
    const save = vi.fn();
    const plain = host();
    expect(await shareBattle(request, plain, save)).toBe("saved-and-copied");
    expect(save).toHaveBeenCalledWith(file);
    expect(plain.clipboard.writeText).toHaveBeenCalledWith(request.url);

    const refused = host({
      share: vi.fn(async () => {
        throw Object.assign(new Error("no gesture"), { name: "NotAllowedError" });
      }),
    });
    expect(await shareBattle(request, refused, vi.fn())).toBe("saved-and-copied");
  });

  it("still saves the card when the clipboard is out of reach", async () => {
    const save = vi.fn();
    expect(await shareBattle(request, {}, save)).toBe("saved");
    expect(save).toHaveBeenCalledWith(file);
  });
});
