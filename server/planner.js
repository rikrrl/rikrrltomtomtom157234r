/**
 * Nachbau-Planer: erzeugt aus der Welt-Analyse eigene Roblox-Modelle
 * (saubere Primitiv-Geometrie) und eigene, selbst geschriebene Luau-Skripte.
 *
 * Es werden ausschließlich eigene Bauteile und eigene Skripte erzeugt.
 * Fremde Modelle, Assets oder private Skripte werden nicht übernommen.
 */

import { CATEGORY_LABELS, MAX_PARTS_PER_MODEL, computeBounds } from './analyzer.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snap(value, step = 0.25) {
  return Math.round(value / step) * step;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function slug(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 32);
}

/** Ein Original-Bauteil in ein eigenes, sauberes Nachbau-Bauteil umrechnen. */
function rebuildPart(part, index) {
  const size = part.size.map((value) => clamp(snap(value, 0.25), 0.5, 512));
  const position = part.position.map((value) => clamp(snap(value, 0.25), -2048, 2048));
  // Dezente eigene Farbvariante, damit der Nachbau ein eigener Inhalt ist.
  const shift = ((index % 5) - 2) * 3;
  const color = part.color.map((channel) => clamp(Math.round(channel + shift), 0, 255));
  return {
    name: `${slug(part.name) || 'Teil'}_${index + 1}`,
    size: size.map(round3),
    position: position.map(round3),
    color,
    material: part.material,
    transparency: round3(clamp(part.transparency, 0, 0.9)),
    shape: part.shape,
  };
}

const SCRIPT_TEMPLATES = {
  building: (model) => ({
    name: 'Gebaeude_Beleuchtung',
    model,
    source: `-- Roblox AI Builder – eigener Nachbau-Skript
-- Modell: ${model}
-- Erzeugt eine Abendbeleuchtung für die Fenster dieses Gebäudes.

local model = script.Parent

local function setup()
	for _, descendant in ipairs(model:GetDescendants()) do
		if descendant:IsA("BasePart") and descendant.Transparency > 0.1 then
			if descendant:FindFirstChildOfClass("PointLight") == nil then
				local light = Instance.new("PointLight")
				light.Brightness = 1.2
				light.Range = 16
				light.Color = Color3.fromRGB(255, 214, 150)
				light.Parent = descendant
			end
		end
	end
end

setup()

local Lighting = game:GetService("Lighting")
task.spawn(function()
	while true do
		local isEvening = Lighting.ClockTime >= 18 or Lighting.ClockTime <= 6
		for _, descendant in ipairs(model:GetDescendants()) do
			if descendant:IsA("BasePart") then
				local light = descendant:FindFirstChildOfClass("PointLight")
				if light then
					light.Enabled = isEvening
				end
			end
		end
		task.wait(4)
	end
end)
`,
  }),
  baseplate: (model) => ({
    name: 'Spawnbereich',
    model,
    source: `-- Roblox AI Builder – eigener Nachbau-Skript
-- Modell: ${model}
-- Legt einen sicheren Spawnpunkt auf der Grundfläche an.

local model = script.Parent

if model:FindFirstChildOfClass("SpawnLocation") == nil then
	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Startpunkt"
	spawn.Size = Vector3.new(8, 1, 8)
	spawn.Anchored = true
	spawn.Neutral = true
	spawn.Transparency = 1
	spawn.CanCollide = false

	local lowest = nil
	for _, descendant in ipairs(model:GetDescendants()) do
		if descendant:IsA("BasePart") then
			if lowest == nil or descendant.Position.Y < lowest.Position.Y then
				lowest = descendant
			end
		end
	end

	if lowest then
		spawn.CFrame = lowest.CFrame + Vector3.new(0, lowest.Size.Y / 2 + 3, 0)
	else
		spawn.Position = Vector3.new(0, 12, 0)
	end

	spawn.Parent = model
end
`,
  }),
  play_area: (model) => ({
    name: 'Spielflaeche_Checkpoints',
    model,
    source: `-- Roblox AI Builder – eigener Nachbau-Skript
-- Modell: ${model}
-- Fügt drei Checkpoints auf der Spielfläche hinzu.

local model = script.Parent

local pads = {}
for _, descendant in ipairs(model:GetDescendants()) do
	if descendant:IsA("BasePart") then
		table.insert(pads, descendant)
	end
end

table.sort(pads, function(a, b)
	return a.Position.X < b.Position.X
end)

for index = 1, math.min(3, #pads) do
	local pad = Instance.new("Part")
	pad.Name = "Checkpoint_" .. index
	pad.Size = Vector3.new(4, 0.5, 4)
	pad.Anchored = true
	pad.CanCollide = false
	pad.Material = Enum.Material.Neon
	pad.Color = Color3.fromRGB(120, 190, 255)
	pad.CFrame = pads[index].CFrame + Vector3.new(0, pads[index].Size.Y / 2 + 0.3, 0)
	pad.Parent = model
end
`,
  }),
  landscape: (model) => ({
    name: 'TagNacht_Zyklus',
    model,
    source: `-- Roblox AI Builder – eigener Nachbau-Skript
-- Modell: ${model}
-- Weicher Tag-/Nachtwechsel für die Landschaft.

local Lighting = game:GetService("Lighting")
local TweenService = game:GetService("TweenService")

local targetTime = 15
task.spawn(function()
	while true do
		targetTime = (targetTime + 6) % 24
		local goal = { ClockTime = targetTime }
		local tween = TweenService:Create(Lighting, TweenInfo.new(6, Enum.EasingStyle.Sine), goal)
		tween:Play()
		task.wait(14)
	end
end)
`,
  }),
  prop: (model) => ({
    name: 'Gegenstand_Effekt',
    model,
    source: `-- Roblox AI Builder – eigener Nachbau-Skript
-- Modell: ${model}
-- Dezenter Leuchteffekt für die Gegenstände dieses Modells.

local model = script.Parent

for _, descendant in ipairs(model:GetDescendants()) do
	if descendant:IsA("BasePart") and descendant.Name:find("Lampe") then
		descendant.Material = Enum.Material.Neon
		local light = Instance.new("PointLight")
		light.Brightness = 1.5
		light.Range = 22
		light.Color = Color3.fromRGB(200, 220, 255)
		light.Parent = descendant
	end
end
`,
  }),
};

/**
 * Erzeugt den kompletten Nachbau-Plan.
 * @returns {{models: Array, scripts: Array, stats: Object, fidelity: number, disclaimer: string}}
 */
export function buildPlan(world, analysis) {
  const models = [];
  const usedNames = new Set();
  const categoryIndex = {};

  for (const cluster of analysis.clusters) {
    const label = CATEGORY_LABELS[cluster.category] || CATEGORY_LABELS.structure;
    categoryIndex[label] = (categoryIndex[label] || 0) + 1;
    let name = `${label} ${categoryIndex[label]}`;
    while (usedNames.has(name)) name = `${name}_`;
    usedNames.add(name);

    const parts = cluster.parts
      .slice()
      .sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])
      .slice(0, MAX_PARTS_PER_MODEL)
      .map(rebuildPart);

    models.push({
      name,
      category: cluster.category,
      categoryLabel: label,
      bounds: computeBounds(cluster.parts),
      parts,
    });
  }

  const scripts = [];
  const scriptCountByCategory = new Map();
  for (const model of models) {
    const template = SCRIPT_TEMPLATES[model.category];
    if (!template) continue;
    const used = scriptCountByCategory.get(model.category) || 0;
    if (used >= 2) continue;
    scriptCountByCategory.set(model.category, used + 1);
    scripts.push(template(model.name));
    if (scripts.length >= 6) break;
  }

  const totalParts = models.reduce((sum, model) => sum + model.parts.length, 0);
  const retention = totalParts / Math.max(1, analysis.partCount);
  const paletteCoverage = analysis.palette.slice(0, 6).reduce((sum, entry) => sum + entry.share, 0);
  const fidelity = Math.round(clamp(40 + retention * 40 + paletteCoverage * 15, 0, 98));

  return {
    models,
    scripts,
    fidelity,
    stats: {
      sourceParts: analysis.partCount,
      builtParts: totalParts,
      modelCount: models.length,
      scriptCount: scripts.length,
      retention: round3(retention),
      paletteCoverage: round3(paletteCoverage),
      bounds: analysis.bounds,
    },
    disclaimer:
      'Der Nachbau besteht ausschließlich aus eigenen Bauteilen und eigenen Skripten, die aus Geometrie- und Farbdaten abgeleitet wurden. Fremde Modelle, Assets und private Skripte werden nicht übernommen.',
  };
}
