/**
 * One download window shared by everything that pulls a GLB.
 *
 * Twelve rigs with five clips each is already over seventy files, and the
 * sculpted arms add to that. Firing them all at once made the browser drop
 * requests (`TypeError: Failed to fetch`), which silently cost figures their
 * strike and death clips — a capture then skipped the attack entirely. Every
 * fetch therefore queues through a small window and is retried before it is
 * given up on, and the window is *global*: two subsystems each politely
 * limiting themselves to four downloads still burst eight.
 */

import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type LoadedGltf = Awaited<ReturnType<GLTFLoader["loadAsync"]>>;

/**
 * A loader for the game's GLBs. Every one of them is meshopt-compressed by
 * `tools/optimize-assets.mjs`, so a loader without the decoder cannot read
 * any of them — always build loaders here.
 */
export function createGltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

const MAX_PARALLEL_DOWNLOADS = 4;

let activeDownloads = 0;
const downloadQueue: (() => void)[] = [];

export async function withDownloadSlot<T>(job: () => Promise<T>): Promise<T> {
  while (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    await new Promise<void>((resolve) => downloadQueue.push(resolve));
  }
  activeDownloads += 1;
  try {
    return await job();
  } finally {
    activeDownloads -= 1;
    downloadQueue.shift()?.();
  }
}

/** Queued GLB fetch with exponential back-off — transient drops are retried. */
export async function loadGltf(
  loader: GLTFLoader,
  url: string,
  attempts = 4,
): Promise<LoadedGltf> {
  let last: unknown = new Error(`could not load ${url}`);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withDownloadSlot(() => loader.loadAsync(url));
    } catch (error) {
      last = error;
      if (attempt === attempts - 1) break;
      // Jittered back-off so a whole army does not retry on the same frame.
      const delay = 240 * 2 ** attempt + Math.random() * 200;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last;
}
