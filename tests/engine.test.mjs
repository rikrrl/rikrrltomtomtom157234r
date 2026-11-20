import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeWorld, classifyPart, normalizeParts, computeBounds, CATEGORY_LABELS } from '../server/analyzer.js';
import { buildPlan } from '../server/planner.js';
import { buildDemoWorld } from '../server/demoWorld.js';

test('normalizeParts verwirft unsichtbare und winzige Bauteile', () => {
  const { parts, rejected } = normalizeParts([
    { position: [0, 0, 0], size: [10, 1, 10], color: [120, 120, 120] },
    { position: [0, 0, 0], size: [0.05, 0.05, 0.05] },
    { position: [0, 0, 0], size: [4, 4, 4], transparency: 1 },
    { position: 'kaputt', size: [4, 4, 4] },
  ]);
  assert.equal(parts.length, 1);
  assert.equal(rejected, 3);
});

test('computeBounds berechnet Hülle inklusive halber Größe', () => {
  const bounds = computeBounds([
    { position: [0, 0, 0], size: [10, 2, 10] },
    { position: [20, 4, 0], size: [2, 2, 2] },
  ]);
  assert.deepEqual(bounds.min, [-5, -1, -5]);
  assert.deepEqual(bounds.max, [21, 5, 5]);
});

test('classifyPart erkennt Straße, Gebäude und Landschaft', () => {
  const bounds = { min: [0, 0, 0], max: [200, 40, 200], size: [200, 40, 200] };
  const road = classifyPart(
    { size: [6, 0.5, 120], color: [70, 70, 74], material: 'Asphalt', position: [0, 0, 0] },
    bounds,
  );
  assert.equal(road, 'road');

  const building = classifyPart(
    { size: [16, 24, 16], color: [200, 200, 200], material: 'Brick', position: [0, 0, 0] },
    bounds,
  );
  assert.equal(building, 'building');

  const landscape = classifyPart(
    { size: [40, 8, 40], color: [60, 140, 70], material: 'Grass', position: [0, 0, 0] },
    bounds,
  );
  assert.equal(landscape, 'landscape');
});

test('analyzeWorld liefert Kategorien, Palette und Cluster für die Demo-Welt', () => {
  const world = buildDemoWorld();
  const analysis = analyzeWorld(world);

  assert.ok(analysis.partCount > 20, 'Demo-Welt sollte viele Bauteile haben');
  assert.ok(analysis.clusters.length >= 3, 'es sollten mehrere Modellgruppen entstehen');
  assert.ok(analysis.categoryCounts.length >= 3);
  assert.ok(analysis.palette.length >= 3);
  assert.ok(analysis.materials.length >= 1);

  for (const entry of analysis.categoryCounts) {
    assert.equal(entry.label, CATEGORY_LABELS[entry.category]);
    assert.ok(entry.count > 0);
  }

  const building = analysis.categoryCounts.find((entry) => entry.category === 'building');
  assert.ok(building && building.count > 0, 'Gebäude müssen erkannt werden');
  const road = analysis.categoryCounts.find((entry) => entry.category === 'road');
  assert.ok(road && road.count > 0, 'Straßen müssen erkannt werden');
});

test('analyzeWorld lehnt leere Welten mit klarer Meldung ab', () => {
  assert.throws(() => analyzeWorld({ parts: [] }), /keine sichtbaren Bauteile/);
});

test('buildPlan erzeugt eigene Modelle, Skripte und Kennzahlen', () => {
  const world = buildDemoWorld();
  const analysis = analyzeWorld(world);
  const plan = buildPlan(world, analysis);

  assert.ok(plan.models.length >= 3);
  assert.ok(plan.stats.builtParts > 0);
  assert.ok(plan.fidelity >= 40 && plan.fidelity <= 98);
  assert.ok(plan.disclaimer.includes('eigene'));

  for (const model of plan.models) {
    assert.ok(model.parts.length > 0);
    for (const part of model.parts) {
      assert.equal(part.position.length, 3);
      assert.equal(part.size.length, 3);
      assert.equal(part.color.length, 3);
      for (const channel of part.color) {
        assert.ok(channel >= 0 && channel <= 255, 'Farbe muss im gültigen Bereich liegen');
      }
      assert.ok(part.size.every((value) => value >= 0.5));
    }
  }

  assert.ok(plan.scripts.length >= 1, 'es müssen eigene Skripte entstehen');
  for (const script of plan.scripts) {
    assert.ok(script.name.length > 0);
    assert.ok(script.source.includes('Roblox AI Builder'));
    assert.ok(plan.models.some((model) => model.name === script.model));
  }
});

test('buildPlan ist deterministisch', () => {
  const world = buildDemoWorld();
  const analysis = analyzeWorld(world);
  const first = buildPlan(world, analysis);
  const second = buildPlan(world, analyzeWorld(world));
  assert.equal(JSON.stringify(first.models), JSON.stringify(second.models));
  assert.equal(first.fidelity, second.fidelity);
});
