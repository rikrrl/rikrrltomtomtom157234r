/**
 * KI-Analyse-Engine für Roblox-Spielwelten.
 *
 * Die Engine arbeitet vollständig offline und deterministisch:
 * Sie liest die vom Studio-Plugin übertragenen Bauteile (Position, Größe, Farbe,
 * Material) und leitet daraus Kategorien, Cluster (= eigene Modelle) und
 * Kennzahlen ab. Es werden keine fremden Assets, Skripte oder Texturen
 * übernommen – nur geometrische Grunddaten, aus denen eigene Modelle entstehen.
 */

export const MAX_INPUT_PARTS = 5000;
export const MAX_PARTS_PER_MODEL = 600;

export const CATEGORY_LABELS = {
  baseplate: 'Grundfläche',
  play_area: 'Spielfläche',
  road: 'Straße',
  path: 'Weg',
  building: 'Gebäude',
  wall: 'Mauer',
  prop: 'Gegenstand',
  landscape: 'Landschaft',
  structure: 'Bauwerk',
};

const NATURAL_MATERIALS = new Set([
  'Grass',
  'LeafyGrass',
  'Ground',
  'Mud',
  'Sand',
  'Rock',
  'Slate',
  'Snow',
  'Sandstone',
  'Basalt',
  'Limestone',
  'Glacier',
  'CrackedLava',
  'Water',
]);

const ROAD_MATERIALS = new Set(['Asphalt', 'Pavement']);
const PATH_MATERIALS = new Set(['Concrete', 'Slate', 'Basalt', 'Limestone']);

const CATEGORY_PRIORITY = [
  'building',
  'road',
  'play_area',
  'landscape',
  'wall',
  'path',
  'prop',
  'baseplate',
  'structure',
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function toVec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  return [num(value[0]), num(value[1]), num(value[2])];
}

function toColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return value.slice(0, 3).map((channel) => clamp(Math.round(num(channel)), 0, 255));
  }
  if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) {
    const hex = value.replace('#', '');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [163, 162, 165];
}

function colorToHex(color) {
  return `#${color.map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function saturation(color) {
  const max = Math.max(...color);
  if (max === 0) return 0;
  return (max - Math.min(...color)) / max;
}

function isGrayish(color) {
  const max = Math.max(...color);
  const min = Math.min(...color);
  return max - min <= 26 && max >= 40 && max <= 190;
}

/** Eingabedaten prüfen und auf ein einheitliches Format bringen. */
export function normalizeParts(rawParts) {
  const list = Array.isArray(rawParts) ? rawParts.slice(0, MAX_INPUT_PARTS) : [];
  const parts = [];
  let rejected = 0;

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      rejected += 1;
      continue;
    }
    const position = toVec3(raw.position);
    const size = toVec3(raw.size);
    if (!position || !size) {
      rejected += 1;
      continue;
    }
    const maxSize = Math.max(size[0], size[1], size[2]);
    const transparency = clamp(num(raw.transparency, 0), 0, 1);
    if (maxSize < 0.2 || transparency >= 0.95) {
      rejected += 1;
      continue;
    }
    const material = typeof raw.material === 'string' && raw.material ? raw.material.slice(0, 40) : 'Plastic';
    parts.push({
      name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 60) : 'Teil',
      className: typeof raw.className === 'string' ? raw.className.slice(0, 40) : 'Part',
      position,
      size: [clamp(size[0], 0.05, 2048), clamp(size[1], 0.05, 2048), clamp(size[2], 0.05, 2048)],
      color: toColor(raw.color),
      material,
      transparency,
      anchored: raw.anchored !== false,
      shape: ['Ball', 'Cylinder', 'Wedge'].includes(raw.shape) ? raw.shape : 'Block',
    });
  }

  return { parts, rejected, total: list.length };
}

export function computeBounds(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let axis = 0; axis < 3; axis += 1) {
      const half = part.size[axis] / 2;
      min[axis] = Math.min(min[axis], part.position[axis] - half);
      max[axis] = Math.max(max[axis], part.position[axis] + half);
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return {
    min: min.map(round3),
    max: max.map(round3),
    size: [round3(max[0] - min[0]), round3(max[1] - min[1]), round3(max[2] - min[2])],
  };
}

/** Bauteil einer Kategorie zuordnen (Gebäude, Straße, Landschaft, …). */
export function classifyPart(part, bounds) {
  const [sx, sy, sz] = part.size;
  const height = sy;
  const footprint = sx * sz;
  const longest = Math.max(sx, sz);
  const shortest = Math.min(sx, sz);
  const elongation = longest / Math.max(0.1, shortest);
  const thin = height <= 2.5;
  const bboxArea = Math.max(1, bounds.size[0] * bounds.size[2]);
  const coversMost = footprint / bboxArea >= 0.45;
  const natural = NATURAL_MATERIALS.has(part.material);
  const sat = saturation(part.color);
  const gray = isGrayish(part.color);

  if (thin && coversMost && footprint >= bboxArea * 0.45) return 'baseplate';
  if (thin && elongation >= 2.2 && (ROAD_MATERIALS.has(part.material) || (gray && footprint >= 30))) {
    return 'road';
  }
  if (thin && elongation >= 2.2 && PATH_MATERIALS.has(part.material) && footprint >= 20) return 'path';
  if (thin && footprint >= 150 && sat >= 0.35) return 'play_area';
  if (natural) return 'landscape';
  if (footprint <= 16 || Math.max(sx, sy, sz) <= 3.5) return 'prop';
  if (height >= 3 && elongation >= 3 && shortest <= 2.5) return 'wall';
  if (height >= 6 && footprint >= 12) return 'building';
  if (height >= 3 && footprint >= 25) return 'building';
  return 'structure';
}

function finalizeCluster(cluster, index) {
  const parts = cluster.parts;
  const bounds = computeBounds(parts);
  const counts = {};
  for (const part of parts) counts[part.category] = (counts[part.category] || 0) + 1;
  const dominant = CATEGORY_PRIORITY.find((category) => counts[category] > 0) || 'structure';
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    id: `cluster-${index + 1}`,
    category: dominant,
    categoryLabel: CATEGORY_LABELS[dominant] || CATEGORY_LABELS.structure,
    categories: sorted.map(([category, count]) => ({
      category,
      label: CATEGORY_LABELS[category] || CATEGORY_LABELS.structure,
      count,
    })),
    parts,
    bounds,
    center: parts.length
      ? [
          round3(parts.reduce((sum, part) => sum + part.position[0], 0) / parts.length),
          round3(parts.reduce((sum, part) => sum + part.position[1], 0) / parts.length),
          round3(parts.reduce((sum, part) => sum + part.position[2], 0) / parts.length),
        ]
      : [0, 0, 0],
  };
}

/**
 * Bauteile räumlich zu Modell-Clustern gruppieren.
 * Kleine Streugruppen werden zu einem Detail-Modell zusammengefasst.
 */
export function clusterParts(parts) {
  const bounds = computeBounds(parts);
  const diagonal = Math.hypot(bounds.size[0], bounds.size[1], bounds.size[2]) || 64;
  const threshold = Math.max(18, diagonal / 12);
  const clusters = [];

  for (const part of parts) {
    let best = null;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = Math.hypot(
        part.position[0] - cluster.center[0],
        part.position[1] - cluster.center[1],
        part.position[2] - cluster.center[2],
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cluster;
      }
    }
    if (best && bestDistance <= threshold) {
      best.parts.push(part);
      best.sum[0] += part.position[0];
      best.sum[1] += part.position[1];
      best.sum[2] += part.position[2];
      const count = best.parts.length;
      best.center = [best.sum[0] / count, best.sum[1] / count, best.sum[2] / count];
    } else {
      clusters.push({
        parts: [part],
        sum: [part.position[0], part.position[1], part.position[2]],
        center: [part.position[0], part.position[1], part.position[2]],
      });
    }
  }

  const maxModels = 16;
  const significant = clusters.filter((cluster) => cluster.parts.length >= 5).sort((a, b) => b.parts.length - a.parts.length);
  const minor = clusters.filter((cluster) => cluster.parts.length < 5);
  const kept = significant.slice(0, maxModels);
  const overflow = significant.slice(maxModels).concat(minor);
  if (overflow.length > 0) kept.push({ parts: overflow.flatMap((cluster) => cluster.parts) });

  return kept.map(finalizeCluster);
}

/** Vollständige Welt-Analyse: Kategorien, Palette, Cluster, Kennzahlen. */
export function analyzeWorld(world) {
  const { parts, rejected, total } = normalizeParts(world?.parts);
  if (parts.length === 0) {
    throw new Error('In der übertragenen Spielwelt wurden keine sichtbaren Bauteile gefunden.');
  }

  const bounds = computeBounds(parts);
  for (const part of parts) {
    part.category = classifyPart(part, bounds);
  }

  const categoryCounts = {};
  for (const part of parts) {
    const entry = categoryCounts[part.category] || {
      category: part.category,
      label: CATEGORY_LABELS[part.category] || CATEGORY_LABELS.structure,
      count: 0,
      volume: 0,
    };
    entry.count += 1;
    entry.volume += part.size[0] * part.size[1] * part.size[2];
    categoryCounts[part.category] = entry;
  }

  const colorCounts = new Map();
  for (const part of parts) {
    const hex = colorToHex(part.color);
    colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
  }
  const palette = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([hex, count]) => ({ hex, count, share: round3(count / parts.length) }));

  const materialCounts = {};
  for (const part of parts) {
    materialCounts[part.material] = (materialCounts[part.material] || 0) + 1;
  }
  const materials = Object.entries(materialCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([material, count]) => ({ material, count }));

  const clusters = clusterParts(parts);
  const averageHeight = parts.reduce((sum, part) => sum + part.size[1], 0) / parts.length;

  return {
    partCount: parts.length,
    inputPartCount: total,
    rejectedParts: rejected,
    bounds,
    palette,
    materials,
    categoryCounts: Object.values(categoryCounts).sort((a, b) => b.count - a.count),
    clusters,
    metrics: {
      averageHeight: round3(averageHeight),
      footprint: round3(bounds.size[0] * bounds.size[2]),
      volume: round3(bounds.size[0] * bounds.size[1] * bounds.size[2]),
      clusterCount: clusters.length,
    },
  };
}
