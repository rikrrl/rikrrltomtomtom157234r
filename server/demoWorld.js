/**
 * Beispiel-Welt für den Demo-Modus.
 *
 * Der Demo-Modus ersetzt Roblox Studio, damit der komplette Ablauf
 * (Erkennung -> Nachbau-Dialog -> Analyse -> Einfügen) auch ohne
 * installiertes Studio getestet werden kann. Die Welt wird deterministisch
 * erzeugt, damit Analyse und Tests reproduzierbar bleiben.
 */

function part(name, position, size, color, material, shape = 'Block', transparency = 0) {
  return {
    name,
    className: 'Part',
    position,
    size,
    color,
    material,
    shape,
    transparency,
    anchored: true,
  };
}

export function buildDemoWorld() {
  const parts = [];

  // Grundfläche
  parts.push(part('Grundfläche', [0, -0.5, 0], [512, 1, 512], [106, 168, 79], 'Grass'));

  // Straßenkreuz
  parts.push(part('Hauptstraße', [0, 0.25, 0], [512, 0.5, 28], [70, 70, 74], 'Asphalt'));
  parts.push(part('Nebenstraße', [0, 0.25, 0], [28, 0.5, 512], [70, 70, 74], 'Asphalt'));

  // Gehwege
  parts.push(part('Gehweg Nord', [0, 0.4, 18], [512, 0.8, 6], [178, 178, 178], 'Concrete'));
  parts.push(part('Gehweg Süd', [0, 0.4, -18], [512, 0.8, 6], [178, 178, 178], 'Concrete'));
  parts.push(part('Gehweg Ost', [18, 0.4, 0], [6, 0.8, 512], [178, 178, 178], 'Concrete'));
  parts.push(part('Gehweg West', [-18, 0.4, 0], [6, 0.8, 512], [178, 178, 178], 'Concrete'));

  // Gebäude mit Dach, Fenstern und Türen
  const buildings = [
    { name: 'Wohnhaus', position: [-70, 12, 70], size: [44, 24, 44], color: [196, 196, 200] },
    { name: 'Büroturm', position: [70, 16, 70], size: [40, 32, 40], color: [176, 188, 208] },
    { name: 'Laden', position: [-70, 9, -70], size: [46, 18, 40], color: [208, 190, 168] },
    { name: 'Wohnblock', position: [70, 14, -70], size: [38, 28, 44], color: [188, 176, 200] },
    { name: 'Halle', position: [0, 10, 96], size: [60, 20, 40], color: [170, 190, 176] },
    { name: 'Lager', position: [0, 8, -96], size: [56, 16, 36], color: [200, 180, 160] },
  ];

  for (const building of buildings) {
    const [x, y, z] = building.position;
    const [sx, sy, sz] = building.size;
    parts.push(part(building.name, [x, y, z], [sx, sy, sz], building.color, 'Concrete'));
    parts.push(part(`${building.name} Dach`, [x, y + sy / 2 + 0.5, z], [sx + 2, 1, sz + 2], [90, 92, 100], 'Slate'));
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        parts.push(
          part(
            `${building.name} Fenster`,
            [x - sx / 3 + column * (sx / 3), y - sy / 3 + row * (sy / 3), z + sz / 2 + 0.2],
            [4, 5, 0.4],
            [120, 190, 235],
            'Glass',
            'Block',
            0.25,
          ),
        );
      }
    }
    parts.push(part(`${building.name} Tür`, [x, 4, z + sz / 2 + 0.3], [5, 8, 0.6], [96, 68, 48], 'Wood'));
  }

  // Bäume (Landschaft)
  const treeSpots = [
    [-140, 140],
    [-150, 60],
    [-130, -60],
    [130, 130],
    [150, 40],
    [120, -120],
    [40, 150],
    [-40, -150],
  ];
  for (const [x, z] of treeSpots) {
    parts.push(part('Baumstamm', [x, 5, z], [2, 10, 2], [92, 64, 40], 'Wood', 'Cylinder'));
    parts.push(part('Baumkrone', [x, 12, z], [12, 10, 12], [64, 132, 70], 'LeafyGrass', 'Ball'));
  }

  // Bänke und Laternen (Gegenstände)
  const props = [
    [-40, 24],
    [40, 24],
    [-40, -24],
    [40, -24],
  ];
  for (const [x, z] of props) {
    parts.push(part('Sitzbank', [x, 1.5, z], [6, 1.2, 2], [120, 84, 52], 'Wood'));
    parts.push(part('Lampe', [x + 4, 7, z], [1, 14, 1], [96, 96, 102], 'Metal', 'Cylinder'));
  }

  // Spielflächen
  parts.push(part('Spielfeld', [-150, 0.6, 0], [70, 1, 70], [90, 200, 255], 'SmoothPlastic'));
  parts.push(part('Spawn-Plattform', [150, 0.6, 0], [60, 1, 60], [200, 120, 255], 'SmoothPlastic'));

  // Mauer / Zaun
  parts.push(part('Mauer Nord', [0, 3, 148], [160, 6, 1.5], [188, 186, 180], 'Concrete'));

  return {
    place: {
      placeId: 0,
      gameName: 'Demo-Welt (Beispielort)',
      source: 'demo',
    },
    parts,
  };
}
