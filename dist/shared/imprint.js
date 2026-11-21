// Single-stroke lettering in a seven-unit em, with the baseline at y = 0.
const glyphs = {
  C: ['4,6 3,7 1,7 0,6 0,1 1,0 3,0 4,1'],
  o: ['1,0 0,1 0,4 1,5 3,5 4,4 4,1 3,0 1,0'],
  a: ['0,4 1,5 3,5 4,4 4,0', '4,3 1,3 0,2 0,1 1,0 3,0 4,1'],
  s: ['4,4 3,5 1,5 0,4 1,3 3,2 4,1 3,0 1,0 0,1'],
  t: ['1,7 1,1 2,0 3,0', '0,5 3,5'],
  e: ['0,2.5 4,2.5 4,4 3,5 1,5 0,4 0,1 1,0 3,0 4,1'],
  r: ['0,0 0,5', '0,3.5 1.5,5 3,5'],
  P: ['0,0 0,7 3,7 4,6 4,4.5 3,3.5 0,3.5'],
  i: ['0,0 0,5', '0,7'],
  n: ['0,0 0,5', '0,4 1,5 3,5 4,4 4,0'],
  '.': ['0,0'],
  m: ['0,0 0,5', '0,4 1,5 2,5 3,4 3,0', '3,4 4,5 5,5 6,4 6,0']
};

export const imprintDepth = 0.28;

const lettering = [];
let advance = 0;
const letterSpacing = 2.65;
for (const letter of 'CoasterPrint.Com') {
  const strokes = glyphs[letter].map(stroke => stroke.split(' ').map(point => point.split(',').map(Number)));
  const width = Math.max(...strokes.flat().map(([x]) => x));
  lettering.push(...strokes.map(stroke => stroke.map(([x, y]) => [x + advance, y])));
  advance += width + letterSpacing;
}

const textWidth = advance - letterSpacing;
const radius = 0.70;
const round = Array.from({length: 12}, (_, index) => {
  const angle = 2 * Math.PI * index / 12;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
});
const outlines = lettering.flatMap(stroke => stroke.flatMap(([x, y], index) => {
  const cap = round.map(([dx, dy]) => [x + dx, y + dy]);
  if (!index) return [cap];
  const [px, py] = stroke[index - 1];
  const length = Math.hypot(x - px, y - py);
  const dx = (py - y) * radius / length, dy = (x - px) * radius / length;
  return [cap, [[px + dx, py + dy], [px - dx, py - dy], [x - dx, y - dy], [x + dx, y + dy]]];
}));

export function makeImprint(CrossSection, keep, surface, thickness) {
  const {min, max} = surface.bounds();
  const [width, height] = max.map((value, index) => value - min[index]);
  // Leave a margin around the whole lettering so a cut cannot open the perimeter.
  const pad = 0.8;
  for (const scale of [0.60, 0.50, 0.42]) {
    const w = (textWidth + 2 * radius) * scale + 2 * pad;
    const h = (7 + 2 * radius) * scale + 2 * pad;
    if (w > width || h > height) continue;
    const rect = keep(CrossSection.square([w, h], true));
    for (const row of [0.16, 0.27, 0.5, 0.73, 0.84]) {
      for (const col of [0.5, 0.3, 0.7, 0, 1]) {
        const x = min[0] + w / 2 + (width - w) * col;
        const y = min[1] + h / 2 + (height - h) * row;
        const positioned = keep(rect.translate([x, y]));
        if (!keep(positioned.subtract(surface)).isEmpty()) continue;
        // Mirror XY lettering so it reads correctly when viewed from below.
        const paths = outlines.map(outline => {
          const vertices = outline.map(([u, v]) => [
            x - (u - textWidth / 2) * scale,
            y + (v - 3.5) * scale
          ]);
          return vertices.reverse();
        });
        const glyph = keep(new CrossSection(paths, 'Positive'));
        const depth = Math.min(imprintDepth, thickness / 2);
        const cutter = keep(glyph.extrude(depth + 0.05));
        return keep(cutter.translate([0, 0, -0.05]));
      }
    }
  }
  return null;
}
