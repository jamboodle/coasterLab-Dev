import {removeReliefSpecks} from '../shared/relief-cleanup.js';
import Module from '../vendor/manifold.js';
import {makeImprint} from '../shared/imprint.js';
import {backingHeight, stampHandle, stampSocket} from './stamp-handle.js';

const epsilon = 1e-7;

function intersects(a, b, c, d) {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const between = (p, q, r) => p.every((value, axis) =>
    value >= Math.min(q[axis], r[axis]) - epsilon && value <= Math.max(q[axis], r[axis]) + epsilon);
  const s = [side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b)];
  return ((s[0] > epsilon && s[1] < -epsilon || s[0] < -epsilon && s[1] > epsilon) &&
    (s[2] > epsilon && s[3] < -epsilon || s[2] < -epsilon && s[3] > epsilon)) ||
    (Math.abs(s[0]) <= epsilon && between(c, a, b)) || (Math.abs(s[1]) <= epsilon && between(d, a, b)) ||
    (Math.abs(s[2]) <= epsilon && between(a, c, d)) || (Math.abs(s[3]) <= epsilon && between(b, c, d));
}

function crossing(points) {
  for (let a = 0; a < points.length; a++) {
    const b = (a + 1) % points.length;
    for (let c = a + 2; c < points.length; c++) {
      const d = (c + 1) % points.length;
      if (d !== a && intersects(points[a], points[b], points[c], points[d])) return [a, b, c, d];
    }
  }
}

const runtime = Module({locateFile: name => new URL('../vendor/' + name, import.meta.url).href}).then(kernel => {
  kernel.setup();
  return kernel;
});

async function build({points, axis, size, height, wall, stampDepth, stampPaths, stampMode, strongCleanup, geometryScript}) {
  for (const [value, low, high, name] of [
    [size, 10, 240, 'Cookie size'], [height, 6, 30, 'Cutter height'],
    [wall, 0.65, 2, 'Wall thickness']
  ]) {
    if (!(value >= low && value <= high)) throw Error(name + ' must be between ' + low + ' and ' + high + ' mm.');
  }
  if (points.length < 3 || points.length > 2500) throw Error('Use a closed outline with 3–2,500 points. Try more trace smoothing.');

  const minX = Math.min(...points.map(p => p[0]));
  const maxY = Math.max(...points.map(p => p[1]));
  const spanX = Math.max(...points.map(p => p[0])) - minX;
  const spanY = maxY - Math.min(...points.map(p => p[1]));
  if (!(spanX > 0 && spanY > 0)) throw Error('Draw a closed outline with an area inside it.');
  const scale = size / (axis === 'width' ? spanX : spanY);
  const mm = points.map(([x, y]) => [(x - minX) * scale, (maxY - y) * scale]);
  const intersection = crossing(mm);
  if (intersection) {
    return {error: 'The outline crosses itself. Edit the highlighted segments or increase trace smoothing.',
      segments: [intersection.slice(0, 2), intersection.slice(2)].map(indices => indices.map(i => points[i]))};
  }

  const [kernel, {binarySTL, signedArea}] = await Promise.all([runtime, import('/' + geometryScript)]);
  const {CrossSection, Manifold} = kernel;
  const owned = [];
  const keep = object => { owned.push(object); return object; };
  const cross = contours => keep(new CrossSection(contours, 'Positive'));
  const offset = (shape, amount) => keep(shape.offset(amount, 'Round', 2, 48));
  try {
    const area = signedArea(mm);
    const inner = cross([area > 0 ? mm : mm.slice().reverse()]);
    if (inner.isEmpty() || Math.abs(area) < 0.2 || inner.toPolygons().length !== 1) {
      throw Error('The outline collapses at this size. Increase the cookie size or redraw the collapsed detail.');
    }
    // Sketch the cookie once. All thickness is added outside this unchanged opening.
    function envelope(thickness) {
      const exterior = offset(inner, thickness).toPolygons().filter(polygon => signedArea(polygon) > 0);
      if (exterior.length !== 1) throw Error('A wall offset collapsed. Increase the cookie size or smooth the outline.');
      return cross(exterior);
    }
    const outer = envelope(wall);
    // The handling end prints against the bed, with the cutting edge above it.
    const lip = envelope(wall + 1.25);
    const {min, max} = lip.bounds();
    const [width, footprintHeight] = max.map((value, index) => value - min[index]);
    if (Math.max(width, footprintHeight) > 250) throw Error('The cutter footprint exceeds 250 mm. Reduce the cookie size or wall thickness.');
    const thin = offset(inner, -0.4);
    if (thin.isEmpty()) throw Error('The opening is too narrow to print at this size. Increase the size or widen the outline.');
    const tips = keep(inner.subtract(offset(thin, 0.4)));
    const pinches = keep(offset(outer, -wall).subtract(inner));
    const issues = [tips, pinches].flatMap(shape => shape.toPolygons())
      .filter(polygon => signedArea(polygon) > 0.075)
      .map(polygon => polygon.map(([x, y]) => [minX + x / scale, maxY - y / scale]));
    function mesh(solid, name) {
      if (solid.decompose().map(keep).length !== 1 || !(solid.volume() > 0)) {
        throw Error('The ' + name + ' must be one connected solid. Increase the size or smooth the outline.');
      }
      return binarySTL(solid, 'CoasterPrint cookie ' + name + '; units mm');
    }

    const joined = keep(Manifold.union([keep(outer.extrude(height)), keep(lip.extrude(1.6))]));
    const opening = keep(keep(inner.extrude(height + 0.4)).translate([0, 0, -0.2]));
    const ring = keep(joined.subtract(opening));
    const solid = keep(keep(keep(ring.translate([-min[0], -min[1], 0])).asOriginal()).setTolerance(0.0001));
    const cutter = mesh(solid, 'cutter');

    function makeStamp() {
      if (stampMode !== 'plain' && !(stampDepth >= 0.6 && stampDepth <= 3)) throw Error('Set stamp depth between 0.6 and 3 mm.');
      const backing = offset(inner, -0.75);
      if (backing.isEmpty() || backing.decompose().map(keep).length !== 1) {
        throw Error('The outline is too narrow for a one-piece stamp. Increase the cookie size.');
      }
      if (stampMode !== 'plain' && !stampPaths?.length) return;
      // Cropping raised detail inside the backing removes border fragments without reshaping the stamp.
      const clip = offset(backing, strongCleanup ? -2.25 : -0.65);
      if (stampMode !== 'plain' && clip.isEmpty()) {
        throw Error('There is no room for embossing inside the edge clearance. Increase the cookie size or use Standard cleanup.');
      }
      const paths = (stampPaths || []).map(path => path.map(([x, y]) => [(x - minX) * scale, (maxY - y) * scale]));
      let details, removedSpecks = 0;
      if (stampMode === 'color') {
        const strokeRadius = 0.48;
        const sourceRadius = strongCleanup ? 0.55 : 0.32;
        const sourceArea = strongCleanup ? 6 : 2.5;
        const lines = [];
        for (const path of paths) {
          if (Math.abs(signedArea(path)) < sourceArea) {
            removedSpecks++;
            continue;
          }
          const region = keep(new CrossSection([path], 'EvenOdd'));
          // Remove hairline spurs before outlining, which would otherwise widen them.
          const cleaned = offset(offset(region, -sourceRadius), sourceRadius);
          if (cleaned.isEmpty()) {
            removedSpecks++;
            continue;
          }
          lines.push(keep(offset(cleaned, strokeRadius).subtract(offset(cleaned, -strokeRadius))));
        }
        details = keep(CrossSection.union(lines));
      } else if (stampMode !== 'plain') {
        const traced = keep(new CrossSection(paths, 'EvenOdd'));
        // Discard a whole silhouette or background fill. The stamp needs interior marks.
        if (keep(traced.intersect(clip)).area() / clip.area() > 0.88) return;
        const broadCores = offset(traced, -1.8);
        details = broadCores.isEmpty() ? traced : keep(traced.subtract(offset(broadCores, 0.9)));
      }
      // Clip after stroking so the clearance margin cannot become an artificial line.
      let relief;
      if (details) {
        const clipped = keep(details.intersect(clip));
        // Keep the opening radius below the 0.48 mm half-width of color outlines.
        const radius = strongCleanup ? (stampMode === 'color' ? 0.41 : 0.55) : 0.34;
        const opened = offset(offset(clipped, -radius), radius);
        const cleaned = removeReliefSpecks(CrossSection, keep, keep(opened.intersect(clip)), strongCleanup ? 4 : 1.25);
        removedSpecks += cleaned.removed;
        relief = cleaned.shape;
        if (relief.isEmpty()) return;
      }

      const bounds = backing.bounds();
      const stampOrigin = [bounds.max[0], -bounds.min[1]];
      // Mirror across X so the impression reads correctly when the stamp turns face down.
      const orient = shape => keep(keep(shape.mirror([1, 0])).translate(stampOrigin));
      const printBacking = orient(backing);
      const socket = stampSocket(kernel, keep, printBacking);
      const {min, max} = socket.boundingBox();
      const keepout = keep(keep(CrossSection.square([max[0] - min[0] + 2, max[1] - min[1] + 2]))
        .translate([min[0] - 1, min[1] - 1]));
      const imprint = makeImprint(CrossSection, keep, keep(printBacking.subtract(keepout)), backingHeight, {compact: true});
      const solidBacking = keep(keep(printBacking.extrude(backingHeight)).subtract(socket));
      const plate = imprint ? keep(solidBacking.subtract(imprint)) : solidBacking;
      let stampMesh, printedRelief, meshError;
      for (const tolerance of relief ? [0, 0.008, 0.035] : [0]) {
        try {
          const shape = tolerance ? keep(keep(relief.simplify(tolerance)).intersect(clip)) : relief;
          if (shape?.isEmpty()) continue;
          let stamp = plate;
          if (shape) {
            const detail = keep(keep(orient(shape).extrude(stampDepth)).translate([0, 0, backingHeight]));
            stamp = keep(Manifold.union([plate, detail]));
            if (tolerance) stamp = keep(keep(stamp.asOriginal()).setTolerance(0.0001));
          }
          stampMesh = mesh(stamp, 'stamp');
          printedRelief = shape;
          break;
        } catch (error) {
          if (error instanceof WebAssembly.RuntimeError) throw error;
          meshError = error;
        }
      }
      if (!stampMesh) throw meshError || Error('The stamp details are too small to print.');
      const {solid: handle, ...handleDimensions} = stampHandle(kernel, keep);
      return {...stampMesh, removedSpecks, imprinted: Boolean(imprint), embossed: Boolean(printedRelief),
        depth: backingHeight + (printedRelief ? stampDepth : 0),
        handle: {...mesh(handle, 'stamp handle'), ...handleDimensions},
        width: bounds.max[0] - bounds.min[0], height: bounds.max[1] - bounds.min[1],
        preview: printedRelief?.toPolygons().map(polygon =>
          polygon.map(([x, y]) => [minX + x / scale, maxY - y / scale])) || []};
    }
    let stamp, stampError;
    try {
      stamp = makeStamp();
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) throw error;
      stampError = error.message;
    }
    return {...cutter, stamp, stampError, issues, width, height: footprintHeight, depth: height,
      cookieWidth: spanX * scale, cookieHeight: spanY * scale};
  } finally {
    for (const object of owned.reverse()) object.delete();
  }
}

self.onmessage = async ({data}) => {
  try {
    const result = await build(data);
    self.postMessage(result, [result.buffer, result.stamp?.buffer, result.stamp?.handle.buffer].filter(Boolean));
  } catch (error) {
    self.postMessage({error: error.message || 'The cutter could not be built. Try more smoothing.'});
  }
};
