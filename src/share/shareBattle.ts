/**
 * Hands a battle to the platform's share sheet, with the most the platform
 * takes: the card image and the link, else the link alone, else the card is
 * saved and the link copied. Call it straight from the click (Web Share needs
 * the user's gesture), with the card already rendered.
 */
export type ShareOutcome =
  /** The share sheet took it. */
  | "shared"
  /** The player closed the share sheet: nothing else happens. */
  | "cancelled"
  /** No share sheet: the image was saved and the link copied. */
  | "saved-and-copied"
  /** No share sheet and no clipboard: the image was saved. */
  | "saved";

export interface ShareRequest {
  url: string;
  title: string;
  text: string;
  /** The battle card, when it is ready. */
  file: File | null;
}

/** The slice of `navigator` used here (fakeable in tests). */
export interface ShareHost {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

export async function shareBattle(
  request: ShareRequest,
  host: ShareHost = navigator,
  save: (file: File) => void = downloadFile,
): Promise<ShareOutcome> {
  if (typeof host.share === "function") {
    const withFile: ShareData | null = request.file
      ? { files: [request.file], title: request.title, text: `${request.text} ${request.url}`, url: request.url }
      : null;
    // Some share targets drop `url` when a file goes with it, so the text carries the link too.
    const data: ShareData =
      withFile && safeCanShare(host, { files: withFile.files })
        ? withFile
        : { title: request.title, text: request.text, url: request.url };
    try {
      await host.share(data);
      return "shared";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
      // NotAllowedError (the gesture expired) or a refused file: fall through.
    }
  }
  if (request.file) save(request.file);
  const copied = await copyText(request.url, host);
  return copied ? "saved-and-copied" : "saved";
}

/** Copies the link; false when there is no clipboard (or no permission). */
export async function copyText(text: string, host: ShareHost = navigator): Promise<boolean> {
  try {
    if (!host.clipboard) return false;
    await host.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function safeCanShare(host: ShareHost, data: ShareData): boolean {
  try {
    return typeof host.canShare === "function" && host.canShare(data);
  } catch {
    return false;
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}
