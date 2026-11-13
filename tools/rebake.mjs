/**
 * Simplify a textured sculpt without smearing its texture.
 *
 * The generated sculpts are textured through an atlas of tiny charts: on a
 * typical figure more than 90% of the vertices sit on a UV seam. A
 * seam-preserving simplifier stalls at about half the triangles there (the
 * 40k-triangle priestess stops at 17k), and one allowed to collapse across
 * seams stretches triangles from one chart into another, which paints faces
 * and coats with patches of the wrong texture.
 *
 * So the texture is rebuilt instead of preserved:
 *   1. vertices that differ only in UV are merged, so the surface is one
 *      connected mesh and the simplifier works on shape and normals alone;
 *   2. the simplified mesh gets fresh UVs from xatlas;
 *   3. each texel of the new atlas is filled from the original texture at
 *      the nearest point of the original surface.
 */

import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import * as watlas from "watlas";

const NORMAL_WEIGHT = 0.5;
const PADDING = 4;
const DILATE_PASSES = 8;

let ready = null;
export function rebakeReady() {
  ready ??= Promise.all([MeshoptSimplifier.ready, watlas.Initialize()]);
  return ready;
}

/**
 * Simplifies `primitive` to at most `targetTriangles`, re-unwraps it and
 * re-bakes its base colour texture at `size` px. Every other vertex
 * attribute (normals, joints, weights) is carried over from the original
 * vertex each new vertex came from.
 *
 * @returns the new triangle count
 */
export async function simplifyAndRebake(document, primitive, targetTriangles, size) {
  await rebakeReady();
  const material = primitive.getMaterial();
  const texture = material?.getBaseColorTexture();
  const uvAttribute = primitive.getAttribute("TEXCOORD_0");
  if (!texture || !uvAttribute || material.getBaseColorTextureInfo().getTexCoord() !== 0) {
    throw new Error("rebake needs a base colour texture on TEXCOORD_0");
  }
  // The texture is rewritten in place, so every slot sharing it follows the
  // new UVs (the rigs reuse the colour atlas as their emissive map). That is
  // only safe if nothing outside this primitive reads it.
  const sharingPrimitives = document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .filter((other) => other !== primitive && other.getMaterial() === material);
  const otherMaterials = texture.listParents().filter((parent) => parent.propertyType === "Material" && parent !== material);
  if (sharingPrimitives.length > 0 || otherMaterials.length > 0) throw new Error("rebake: texture is shared with another surface");
  for (const slot of ["getNormalTexture", "getOcclusionTexture", "getMetallicRoughnessTexture", "getEmissiveTexture"]) {
    const other = material[slot]();
    if (other && other !== texture) throw new Error(`rebake: ${slot.slice(3)} would need baking too`);
  }

  const positions = floatArray(primitive.getAttribute("POSITION"));
  const normals = primitive.getAttribute("NORMAL") ? floatArray(primitive.getAttribute("NORMAL")) : null;
  const uvs = floatArray(uvAttribute);
  const indices = Uint32Array.from(primitive.getIndices().getArray());
  const vertexCount = positions.length / 3;

  // 1. One vertex per (position, normal): UV seams no longer split the surface.
  const canonical = new Uint32Array(vertexCount);
  const seen = new Map();
  for (let v = 0; v < vertexCount; v += 1) {
    const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
    const candidates = seen.get(key);
    let match = -1;
    if (candidates) {
      for (const c of candidates) {
        if (!normals || dot3(normals, v, normals, c) > 0.99) {
          match = c;
          break;
        }
      }
    }
    if (match < 0) {
      if (candidates) candidates.push(v);
      else seen.set(key, [v]);
      match = v;
    }
    canonical[v] = match;
  }
  const merged = indices.map((index) => canonical[index]);

  // 2. Simplify on shape and normals.
  const attributes = normals ?? new Float32Array(vertexCount * 3);
  let target = targetTriangles;
  let simplified = merged;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    [simplified] = MeshoptSimplifier.simplifyWithAttributes(
      merged,
      positions,
      3,
      attributes,
      3,
      [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT],
      null,
      target * 3,
      1,
      ["Permissive"],
    );
    if (simplified.length / 3 <= targetTriangles) break;
    target = Math.floor(target * 0.98);
  }

  // Compact: the simplified mesh's own vertex list, as original vertex ids.
  const used = new Map();
  const sourceVertex = [];
  const compactIndices = new Uint32Array(simplified.length);
  for (let i = 0; i < simplified.length; i += 1) {
    let local = used.get(simplified[i]);
    if (local === undefined) {
      local = sourceVertex.length;
      used.set(simplified[i], local);
      sourceVertex.push(simplified[i]);
    }
    compactIndices[i] = local;
  }
  const compactPositions = gather(positions, 3, sourceVertex);
  const compactNormals = normals ? gather(normals, 3, sourceVertex) : null;

  // 3. Fresh UVs.
  const atlas = new watlas.Atlas();
  const declaration = {
    vertexCount: sourceVertex.length,
    vertexPositionData: compactPositions,
    vertexPositionStride: 12,
    indexData: compactIndices,
    indexCount: compactIndices.length,
  };
  if (compactNormals) {
    declaration.vertexNormalData = compactNormals;
    declaration.vertexNormalStride = 12;
  }
  atlas.addMesh(declaration);
  atlas.generate({}, { resolution: size, padding: PADDING, bilinear: true });
  if (atlas.atlasCount !== 1) throw new Error(`xatlas packed ${atlas.atlasCount} atlases`);
  const width = atlas.width;
  const height = atlas.height;
  const mesh = atlas.getMesh(0);
  const finalIndices = new Uint32Array(mesh.indexCount);
  mesh.getIndexArray(finalIndices);
  const finalSource = new Uint32Array(mesh.vertexCount);
  const texels = new Float32Array(mesh.vertexCount * 2);
  for (let v = 0; v < mesh.vertexCount; v += 1) {
    const vertex = mesh.getVertex(v);
    finalSource[v] = sourceVertex[vertex.xref];
    texels[v * 2] = vertex.uv[0];
    texels[v * 2 + 1] = vertex.uv[1];
  }
  atlas.delete();

  // 4. Bake.
  const source = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const baked = bake({
    originalPositions: positions,
    originalUvs: uvs,
    originalIndices: indices,
    texture: source,
    positions,
    normals,
    finalIndices,
    finalSource,
    texels,
    width,
    height,
  });
  const png = await sharp(baked, { raw: { width, height, channels: 4 } }).png().toBuffer();
  texture.setImage(new Uint8Array(png)).setMimeType("image/png").setURI("");

  // 5. Rebuild the primitive's vertex streams.
  for (const semantic of primitive.listSemantics()) {
    const attribute = primitive.getAttribute(semantic);
    if (semantic === "TEXCOORD_0") {
      const uv = new Float32Array(mesh.vertexCount * 2);
      for (let v = 0; v < mesh.vertexCount; v += 1) {
        uv[v * 2] = texels[v * 2] / width;
        uv[v * 2 + 1] = texels[v * 2 + 1] / height;
      }
      primitive.setAttribute(semantic, attribute.clone().setArray(uv));
      continue;
    }
    const elementSize = attribute.getElementSize();
    const array = attribute.getArray();
    const remapped = new array.constructor(mesh.vertexCount * elementSize);
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      for (let c = 0; c < elementSize; c += 1) remapped[v * elementSize + c] = array[finalSource[v] * elementSize + c];
    }
    primitive.setAttribute(semantic, attribute.clone().setArray(remapped));
  }
  primitive.setIndices(primitive.getIndices().clone().setArray(finalIndices));
  return finalIndices.length / 3;
}

function floatArray(accessor) {
  const count = accessor.getCount();
  const size = accessor.getElementSize();
  const out = new Float32Array(count * size);
  const element = new Array(size).fill(0);
  for (let i = 0; i < count; i += 1) {
    accessor.getElement(i, element);
    for (let c = 0; c < size; c += 1) out[i * size + c] = element[c];
  }
  return out;
}

function gather(array, size, ids) {
  const out = new Float32Array(ids.length * size);
  for (let i = 0; i < ids.length; i += 1) {
    for (let c = 0; c < size; c += 1) out[i * size + c] = array[ids[i] * size + c];
  }
  return out;
}

function dot3(a, i, b, j) {
  return a[i * 3] * b[j * 3] + a[i * 3 + 1] * b[j * 3 + 1] + a[i * 3 + 2] * b[j * 3 + 2];
}

/** Uniform grid over the original triangles, for nearest-surface queries. */
function buildGrid(positions, indices) {
  const triangles = indices.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let edge = 0;
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = indices[t * 3 + k];
      for (let c = 0; c < 3; c += 1) {
        min[c] = Math.min(min[c], positions[v * 3 + c]);
        max[c] = Math.max(max[c], positions[v * 3 + c]);
      }
    }
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    edge += Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2]);
  }
  const cell = Math.max((edge / triangles) * 2, 1e-6);
  const dims = [0, 1, 2].map((c) => Math.max(1, Math.ceil((max[c] - min[c]) / cell)));
  const cells = new Map();
  const normals = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t += 1) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    const lo = [0, 1, 2].map((k) => Math.min(positions[a * 3 + k], positions[b * 3 + k], positions[c * 3 + k]));
    const hi = [0, 1, 2].map((k) => Math.max(positions[a * 3 + k], positions[b * 3 + k], positions[c * 3 + k]));
    const from = lo.map((value, k) => Math.min(dims[k] - 1, Math.floor((value - min[k]) / cell)));
    const to = hi.map((value, k) => Math.min(dims[k] - 1, Math.floor((value - min[k]) / cell)));
    for (let x = from[0]; x <= to[0]; x += 1) {
      for (let y = from[1]; y <= to[1]; y += 1) {
        for (let z = from[2]; z <= to[2]; z += 1) {
          const key = (x * dims[1] + y) * dims[2] + z;
          const list = cells.get(key);
          if (list) list.push(t);
          else cells.set(key, [t]);
        }
      }
    }
    const e1 = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    normals.set([n[0] / length, n[1] / length, n[2] / length], t * 3);
  }
  return { min, cell, dims, cells, normals };
}

/**
 * Closest point on triangle abc to p (Ericson, Real-Time Collision Detection
 * 5.1.5), written into `out` as [distance², u, v, w] barycentrics.
 */
function closestOnTriangle(p, positions, a, b, c, out) {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const abx = positions[b * 3] - ax, aby = positions[b * 3 + 1] - ay, abz = positions[b * 3 + 2] - az;
  const acx = positions[c * 3] - ax, acy = positions[c * 3 + 1] - ay, acz = positions[c * 3 + 2] - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let u = 1;
  let v = 0;
  let w = 0;
  if (d1 > 0 || d2 > 0) {
    const bpx = p[0] - positions[b * 3], bpy = p[1] - positions[b * 3 + 1], bpz = p[2] - positions[b * 3 + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = p[0] - positions[c * 3], cpy = p[1] - positions[c * 3 + 1], cpz = p[2] - positions[c * 3 + 2];
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      u = 0;
      v = 1;
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      v = d1 / (d1 - d3);
      u = 1 - v;
    } else if (d6 >= 0 && d5 <= d6) {
      u = 0;
      w = 1;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      w = d2 / (d2 - d6);
      u = 1 - w;
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      v = 1 - w;
      u = 0;
    } else {
      const denominator = 1 / (va + vb + vc);
      v = vb * denominator;
      w = vc * denominator;
      u = 1 - v - w;
    }
  }
  const qx = ax + abx * v + acx * w - p[0];
  const qy = ay + aby * v + acy * w - p[1];
  const qz = az + abz * v + acz * w - p[2];
  out[0] = qx * qx + qy * qy + qz * qz;
  out[1] = u;
  out[2] = v;
  out[3] = w;
}

/**
 * Nearest original triangle to p, preferring ones facing the same way as
 * the simplified surface there (a thin cape has two sides a hair apart).
 */
function nearest(grid, positions, indices, p, n, result) {
  const { min, cell, dims, cells, normals } = grid;
  const scratch = SCRATCH;
  let best = Infinity;
  result.triangle = -1;
  // Cell of p, and how far p is from the nearest face of that cell: after
  // scanning `ring` shells, every triangle closer than ring * cell + inset has
  // been tested.
  let inset = Infinity;
  const centre = CENTRE;
  for (let k = 0; k < 3; k += 1) {
    const offset = (p[k] - min[k]) / cell;
    centre[k] = Math.floor(offset);
    const within = offset - centre[k];
    inset = Math.min(inset, within * cell, (1 - within) * cell);
  }
  const maxRing = Math.max(dims[0], dims[1], dims[2]);
  for (let ring = 0; ring <= maxRing; ring += 1) {
    for (let x = centre[0] - ring; x <= centre[0] + ring; x += 1) {
      if (x < 0 || x >= dims[0]) continue;
      const edgeX = x === centre[0] - ring || x === centre[0] + ring;
      for (let y = centre[1] - ring; y <= centre[1] + ring; y += 1) {
        if (y < 0 || y >= dims[1]) continue;
        const edgeY = edgeX || y === centre[1] - ring || y === centre[1] + ring;
        for (let z = centre[2] - ring; z <= centre[2] + ring; z += 1) {
          if (z < 0 || z >= dims[2]) continue;
          // Only the shell at this ring; the inside was scanned already.
          if (!edgeY && z !== centre[2] - ring && z !== centre[2] + ring) continue;
          const list = cells.get((x * dims[1] + y) * dims[2] + z);
          if (!list) continue;
          for (let i = 0; i < list.length; i += 1) {
            const t = list[i];
            closestOnTriangle(p, positions, indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2], scratch);
            const facing = n ? normals[t * 3] * n[0] + normals[t * 3 + 1] * n[1] + normals[t * 3 + 2] * n[2] : 1;
            // A back-facing surface counts as four times as far away.
            const score = facing < 0 ? scratch[0] * 16 : scratch[0];
            if (score < best) {
              best = score;
              result.triangle = t;
              result.u = scratch[1];
              result.v = scratch[2];
              result.w = scratch[3];
            }
          }
        }
      }
    }
    if (result.triangle >= 0 && Math.sqrt(best) <= ring * cell + inset) break;
  }
}

const SCRATCH = [0, 0, 0, 0];
const CENTRE = [0, 0, 0];

function bake({ originalPositions, originalUvs, originalIndices, texture, positions, normals, finalIndices, finalSource, texels, width, height }) {
  const grid = buildGrid(originalPositions, originalIndices);
  const out = new Uint8Array(width * height * 4);
  const filled = new Uint8Array(width * height);
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  const hit = { triangle: -1, u: 0, v: 0, w: 0 };
  const colour = [0, 0, 0, 0];

  for (let t = 0; t < finalIndices.length / 3; t += 1) {
    const i0 = finalIndices[t * 3], i1 = finalIndices[t * 3 + 1], i2 = finalIndices[t * 3 + 2];
    const x0 = texels[i0 * 2], y0 = texels[i0 * 2 + 1];
    const x1 = texels[i1 * 2], y1 = texels[i1 * 2 + 1];
    const x2 = texels[i2 * 2], y2 = texels[i2 * 2 + 1];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue;
    const s0 = finalSource[i0], s1 = finalSource[i1], s2 = finalSource[i2];
    const fromX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1));
    const toX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
    const fromY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1));
    const toY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        let b1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) / area;
        let b2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / area;
        let b0 = 1 - b1 - b2;
        // Texels up to about one texel outside the edge are filled too, so
        // bilinear filtering at a chart border never reads the background.
        const margin = 1.5 / Math.sqrt(Math.abs(area));
        if (b0 < -margin || b1 < -margin || b2 < -margin) continue;
        b0 = Math.max(0, b0);
        b1 = Math.max(0, b1);
        b2 = Math.max(0, b2);
        const sum = b0 + b1 + b2;
        b0 /= sum;
        b1 /= sum;
        b2 /= sum;
        const inside = b0 > 0 && b1 > 0 && b2 > 0;
        const index = y * width + x;
        if (filled[index] === 2 || (filled[index] === 1 && !inside)) continue;
        for (let k = 0; k < 3; k += 1) {
          p[k] = positions[s0 * 3 + k] * b0 + positions[s1 * 3 + k] * b1 + positions[s2 * 3 + k] * b2;
          n[k] = normals ? normals[s0 * 3 + k] * b0 + normals[s1 * 3 + k] * b1 + normals[s2 * 3 + k] * b2 : 0;
        }
        nearest(grid, originalPositions, originalIndices, p, normals ? n : null, hit);
        if (hit.triangle < 0) continue;
        const a = originalIndices[hit.triangle * 3], b = originalIndices[hit.triangle * 3 + 1], c = originalIndices[hit.triangle * 3 + 2];
        const u = originalUvs[a * 2] * hit.u + originalUvs[b * 2] * hit.v + originalUvs[c * 2] * hit.w;
        const v = originalUvs[a * 2 + 1] * hit.u + originalUvs[b * 2 + 1] * hit.v + originalUvs[c * 2 + 1] * hit.w;
        sampleBilinear(texture, u, v, colour);
        out.set(colour, index * 4);
        filled[index] = inside ? 2 : 1;
      }
    }
  }
  dilate(out, filled, width, height);
  return out;
}

function sampleBilinear(texture, u, v, out) {
  const { data, info } = texture;
  const x = u * info.width - 0.5;
  const y = v * info.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const clampX = (value) => Math.min(info.width - 1, Math.max(0, value));
  const clampY = (value) => Math.min(info.height - 1, Math.max(0, value));
  const xa = clampX(x0), xb = clampX(x0 + 1), ya = clampY(y0), yb = clampY(y0 + 1);
  const channels = info.channels;
  for (let c = 0; c < 4; c += 1) {
    const top = data[(ya * info.width + xa) * channels + c] * (1 - fx) + data[(ya * info.width + xb) * channels + c] * fx;
    const bottom = data[(yb * info.width + xa) * channels + c] * (1 - fx) + data[(yb * info.width + xb) * channels + c] * fx;
    out[c] = Math.round(top * (1 - fy) + bottom * fy);
  }
}

/** Grows every chart outwards so mipmaps never mix in the background. */
function dilate(out, filled, width, height) {
  let frontier = filled;
  for (let pass = 0; pass < DILATE_PASSES; pass += 1) {
    const next = frontier.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (frontier[index]) continue;
        const sum = [0, 0, 0, 0];
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const neighbour = ny * width + nx;
            if (!frontier[neighbour]) continue;
            for (let c = 0; c < 4; c += 1) sum[c] += out[neighbour * 4 + c];
            count += 1;
          }
        }
        if (count === 0) continue;
        for (let c = 0; c < 4; c += 1) out[index * 4 + c] = Math.round(sum[c] / count);
        next[index] = 1;
      }
    }
    frontier = next;
  }
}
