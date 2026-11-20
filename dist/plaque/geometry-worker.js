import Module from '../vendor/manifold.js';

async function build({paths, perimeter, viewWidth, width, largest, tiers, geometryScript}) {
  const [kernel, {pathContours, binarySTL}] = await Promise.all([
    Module({locateFile: name => new URL('../vendor/' + name, import.meta.url).href}),
    import('/' + geometryScript)
  ]);
  kernel.setup();
  const {CrossSection} = kernel;
  const owned = [];
  const keep = value => { owned.push(value); return value; };
  const contours = (d, rule) => {
    const polygon = pathContours(d, 220 / viewWidth, 0.025);
    return polygon.length ? keep(new CrossSection(polygon, rule)) : keep(CrossSection.union([]));
  };
  try {
    const raw = paths.map(({color, d, fillRule}) => ({
      color, shape: contours(d, fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero')
    }));
    let silhouette = perimeter ? contours(perimeter, 'NonZero') : keep(CrossSection.union(raw.map(region => region.shape)));
    if (silhouette.isEmpty()) throw Error('The trace has no printable outline.');
    const components = silhouette.decompose().map(keep).sort((a, b) => b.area() - a.area());
    if (largest) silhouette = components[0];
    else if (components.length > 1) throw Error('The artwork has disconnected outlines. Enable Keep only the largest outline, or connect the artwork before importing.');
    const original = silhouette.bounds();
    const scale = width / (original.max[0] - original.min[0]);
    const normal = shape => keep(keep(shape.translate([-original.min[0], -original.min[1]])).scale(scale));
    const base = normal(silhouette);
    const dimensions = base.bounds().max;
    if (dimensions[1] > 250) throw Error('The finished height exceeds 250 mm. Reduce finished width.');
    const detail = new Map();
    let covered;
    // CoasterPrint's trace paints later paths over earlier ones.
    for (const region of raw.reverse()) {
      const clipped = keep(region.shape.intersect(silhouette));
      const visible = covered ? keep(clipped.subtract(covered)) : clipped;
      if (!visible.isEmpty()) detail.set(region.color, normal(visible));
      covered = covered ? keep(covered.add(clipped)) : clipped;
    }
    const sorted = [...tiers].sort((a, b) => a.top - b.top);
    const printable = sorted.filter(tier => detail.has(tier.source));
    const omitted = sorted.length - printable.length;
    if (!printable.length) throw Error('No visible colors remain inside the outline.');
    let upper;
    const sections = [];
    for (let index = printable.length - 1; index >= 0; index--) {
      const shape = detail.get(printable[index].source);
      upper = index === 0 ? base : upper ? keep(upper.add(shape)) : shape;
      sections[index] = upper;
    }

    function meshTiers(inset) {
      const start = owned.length, parts = [];
      try {
        for (const [index, tier] of printable.entries()) {
          const source = sections[index];
          // Increasing the inset with tier height keeps the modified footprints nested.
          const reliefInset = inset * index / Math.max(1, sections.length - 1);
          const section = reliefInset ? keep(source.offset(-reliefInset, 'Round', 2, 12)) : source;
          if (section.isEmpty()) throw Error('Tier ' + (index + 1) + ' is too small to preserve.');
          const bottom = index ? printable[index - 1].top : 0;
          const solid = keep(keep(section.extrude(tier.top - bottom)).translate([0, 0, bottom]));
          const cleaned = keep(keep(solid.asOriginal()).setTolerance(0.0001));
          const name = 'tier-' + String(index + 1).padStart(2, '0');
          try {
            const {buffer} = binarySTL(cleaned, 'CoasterPrint plaque ' + name + '; units mm');
            parts.push({...tier, bottom, buffer, polygons: section.toPolygons(), name});
          } catch (error) {
            if (error instanceof WebAssembly.RuntimeError) throw error;
            throw Error('Tier ' + (index + 1) + ': ' + error.message);
          }
        }
        return parts;
      } finally {
        while (owned.length > start) {
          try { owned.pop().delete(); } catch { /* The worker is discarded if WASM traps. */ }
        }
      }
    }

    let lastError;
    // Sub-pixel relief insets can resolve coincident edge contacts at export precision.
    for (const inset of [0, 0.008, 0.02, 0.045, 0.08]) {
      try {
        return {parts: meshTiers(inset), inset, omitted, trimmed: largest ? components.length - 1 : 0,
          width: dimensions[0], height: dimensions[1], depth: printable.at(-1).top};
      } catch (error) {
        if (error instanceof WebAssembly.RuntimeError) throw Error('The geometry engine hit a memory error. Try fewer colors or Smooth detail.');
        lastError = error;
      }
    }
    throw Error(lastError.message + ' Try Smooth detail or fewer colors.');
  } finally {
    for (const object of owned.reverse()) {
      try { object.delete(); } catch { /* A trapped engine is discarded with this worker. */ }
    }
  }
}

self.onmessage = async event => {
  try {
    const result = await build(event.data);
    self.postMessage({result}, result.parts.map(part => part.buffer));
  } catch (error) {
    self.postMessage({error: error.message || 'Unable to build the plaque.'});
  }
};
