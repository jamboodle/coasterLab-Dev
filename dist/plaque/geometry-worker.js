import {makeImprint} from '../shared/imprint.js';
import {removeReliefSpecks} from '../shared/relief-cleanup.js';
import Module from '../vendor/manifold.js';

async function build({paths, perimeter, perimeterMask, rimColor, rimWidth, rimSeal, removedEdges,
    viewWidth, width, largest, cleanRelief, strongCleanup, tiers, geometryScript}) {
  self.postMessage({progress: 'Preparing the solid backing…'});
  const [kernel, {pathContours, signedArea, binarySTL}] = await Promise.all([
    Module({locateFile: name => new URL('../vendor/' + name, import.meta.url).href}),
    import('/' + geometryScript)
  ]);
  kernel.setup();
  const {CrossSection} = kernel;
  const owned = [];
  const keep = value => { owned.push(value); return value; };
  const cross = (polygons, rule = 'NonZero') =>
    polygons.length ? keep(new CrossSection(polygons, rule)) : keep(CrossSection.union([]));
  const contours = (d, rule) => cross(pathContours(d, 220 / viewWidth, 0.012), rule);
  const union = shapes => keep(CrossSection.union(shapes));
  const offset = (shape, amount) => keep(shape.offset(amount, 'Round', 2, 20));

  function applyTraceRim(raw, outline) {
    if (!outline || !rimColor || !rimWidth) return;
    const region = raw.find(entry => entry.color === rimColor);
    if (!region) return;
    const px = 220 / viewWidth;
    const mask = perimeterMask ? contours(perimeterMask, 'NonZero') : null;
    const restrict = shape => mask ? keep(shape.intersect(mask)) : shape;
    const original = union(raw.map(entry => entry.shape));
    const rim = restrict(keep(outline.subtract(offset(outline, -rimWidth * px))));
    let patch = keep(rim.subtract(original));
    const holes = original.toPolygons().filter(polygon => signedArea(polygon) < 0).map(polygon => polygon.slice().reverse());
    if (holes.length) patch = keep(patch.subtract(cross(holes, 'Positive')));
    if (!patch.isEmpty()) region.shape = keep(region.shape.add(patch));
    if (removedEdges) {
      const formerSpecks = restrict(keep(offset(contours(removedEdges, 'NonZero'), 0.25 * px).intersect(outline)));
      if (!formerSpecks.isEmpty()) region.shape = keep(region.shape.add(formerSpecks));
    }
    if (!rimSeal) return;
    const seal = restrict(keep(outline.subtract(offset(outline, -rimSeal * px))));
    for (const entry of raw) {
      entry.shape = keep(entry === region ? entry.shape.add(seal) : entry.shape.subtract(seal));
    }
  }
  try {
    const raw = paths.map(({color, d, fillRule}) => ({
      color, shape: contours(d, fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero')
    }));
    const outline = perimeter ? contours(perimeter, 'NonZero') : null;
    applyTraceRim(raw, outline);
    let silhouette = outline || union(raw.map(region => region.shape));
    if (silhouette.isEmpty()) throw Error('The trace has no printable outline.');
    const components = silhouette.decompose().map(keep).sort((a, b) => b.area() - a.area());
    if (largest) silhouette = components[0];
    else if (components.length > 1) throw Error('The artwork has disconnected outlines. Enable Keep only the largest outline, or connect the artwork before importing.');
    const original = silhouette.bounds();
    const artworkWidth = original.max[0] - original.min[0];
    const artworkHeight = original.max[1] - original.min[1];
    const requestedScale = width / artworkWidth;
    const scale = Math.min(requestedScale, 240 / artworkHeight);
    const scaledToHeight = scale < requestedScale;
    const normal = shape => keep(keep(shape.translate([-original.min[0], -original.min[1]])).scale(scale));
    // A single filled outline supports the relief. Raster holes belong only to the upper tiers.
    const loops = silhouette.toPolygons();
    const outer = loops.filter(polygon => signedArea(polygon) > 0);
    const backing = normal(cross(outer, 'Positive'));
    const simplified = keep(backing.simplify(0.025));
    const base = simplified.toPolygons().length === 1 ? simplified : backing;
    const filledHoles = loops.length - outer.length;
    const dimensions = base.bounds().max;
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
    let printable = sorted.filter(tier => detail.has(tier.source));
    if (!printable.length) throw Error('No visible colors remain inside the outline.');
    let upper;
    let sections = [];
    for (let index = printable.length - 1; index >= 0; index--) {
      const shape = detail.get(printable[index].source);
      upper = index === 0 ? base : upper ? keep(upper.add(shape)) : shape;
      sections[index] = upper;
    }

    self.postMessage({progress: 'Cleaning and stacking relief tiers…'});
    let filtered = 0;
    if (cleanRelief && sections.length > 1) {
      // Opening removes thin towers; closing rounds notches from raster tracing.
      // Each layer is intersected with its support so the stepped relief stays nested.
      const radius = strongCleanup ? 0.55 : 0.32;
      const minimumArea = strongCleanup ? 4 : 1.25;
      for (let index = 1; index < sections.length; index++) {
        const opened = offset(offset(sections[index], -radius), radius);
        const rounded = opened.isEmpty() ? opened : offset(offset(opened, radius), -radius);
        const section = keep(rounded.intersect(sections[index - 1]));
        const minimum = index === 1
          ? largest => Math.max(minimumArea, Math.min(55, largest * 0.004))
          : minimumArea;
        const cleaned = removeReliefSpecks(CrossSection, keep, section, minimum);
        filtered += cleaned.removed;
        sections[index] = cleaned.shape;
      }
      printable = printable.filter((_, index) => !sections[index].isEmpty());
      sections = sections.filter(section => !section.isEmpty());
    }
    const omitted = sorted.length - printable.length;

    function meshTiers(inset, repair) {
      const start = owned.length, parts = [];
      let support, imprinted = false;
      try {
        for (const [index, tier] of printable.entries()) {
          const source = sections[index];
          // Increasing the inset with tier height keeps the modified footprints nested.
          const reliefInset = inset * index / Math.max(1, sections.length - 1);
          let section = reliefInset ? keep(source.offset(-reliefInset, 'Round', 2, 12)) : source;
          if (repair) {
            // Remove near-coincident contour vertices before triangulation, including the base.
            if (index && repair >= 0.025) section = offset(offset(section, -repair), repair);
            if (index) section = keep(section.simplify(repair));
          }
          if (support) section = keep(section.intersect(support));
          if (!index && section.toPolygons().length !== 1) throw Error('The plaque backing must have one closed outer boundary.');
          support = section;
          if (section.isEmpty()) throw Error('Tier ' + (index + 1) + ' is too small to preserve.');
          const bottom = index ? printable[index - 1].top : 0;
          let solid = keep(keep(section.extrude(tier.top - bottom)).translate([0, 0, bottom]));
          if (index === 0) {
            const imprint = makeImprint(CrossSection, keep, section, tier.top - bottom);
            if (imprint) {
              solid = keep(solid.subtract(imprint));
              imprinted = true;
            }
          }
          const cleaned = repair === 0.004 ? solid : keep(keep(solid.asOriginal()).setTolerance(0.0001));
          self.postMessage({progress: 'Checking mesh · tier ' + (index + 1) + ' of ' + printable.length + '…'});
          const name = 'tier-' + String(index + 1).padStart(2, '0');
          try {
            const {buffer} = binarySTL(cleaned, 'CoasterPrint plaque ' + name + '; units mm');
            parts.push({...tier, bottom, buffer, polygons: section.toPolygons(), name});
          } catch (error) {
            if (error instanceof WebAssembly.RuntimeError) throw error;
            throw Error('Tier ' + (index + 1) + ': ' + error.message);
          }
        }
        return {parts, imprinted};
      } finally {
        while (owned.length > start) {
          try { owned.pop().delete(); } catch { /* The worker is discarded if WASM traps. */ }
        }
      }
    }

    let lastError;
    // Retry the geometry before extrusion; STL validation stays enabled on every attempt.
    for (const [inset, repair] of [[0, 0], [0.008, 0.004], [0.02, 0.012], [0.045, 0.028], [0.08, 0.065], [0.12, 0.12]]) {
      try {
        return {...meshTiers(inset, repair), inset, repair, omitted, filtered, cleaned: cleanRelief,
          trimmed: largest ? components.length - 1 : 0, filledHoles, scaledToHeight, width: dimensions[0], height: dimensions[1], depth: printable.at(-1).top};
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
