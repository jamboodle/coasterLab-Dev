import Module from '../vendor/manifold.js';

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

async function build({points, axis, size, height, wall, edge, grip, geometryScript}) {
  for (const [value, low, high, name] of [
    [size, 10, 240, 'Cookie size'], [height, 6, 30, 'Cutter height'],
    [wall, 0.8, 4, 'Wall thickness'], [edge, 0.45, 2, 'Cutting-edge thickness'], [grip, 1, 8, 'Grip width']
  ]) {
    if (!(value >= low && value <= high)) throw Error(name + ' must be between ' + low + ' and ' + high + ' mm.');
  }
  if (edge >= wall) throw Error('Set the cutting-edge thickness below the supporting wall thickness.');
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

  const [{CrossSection, Manifold}, {binarySTL, signedArea}] = await Promise.all([runtime, import('/' + geometryScript)]);
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
    const tip = envelope(edge), support = envelope(wall), handle = envelope(wall + grip);
    const {min, max} = handle.bounds();
    const [width, footprintHeight] = max.map((value, index) => value - min[index]);
    if (Math.max(width, footprintHeight) > 250) throw Error('The grip makes the footprint larger than 250 mm. Reduce cookie size or grip width.');
    const thin = offset(inner, -0.4);
    if (thin.isEmpty()) throw Error('The opening is too narrow to print at this size. Increase the size or widen the outline.');
    const tips = keep(inner.subtract(offset(thin, 0.4)));
    const pinches = keep(offset(tip, -edge).subtract(inner));
    const issues = [tips, pinches].flatMap(shape => shape.toPolygons())
      .filter(polygon => signedArea(polygon) > 0.075)
      .map(polygon => polygon.map(([x, y]) => [minX + x / scale, maxY - y / scale]));
    const ring = outline => keep(outline.subtract(inner));
    const gripHeight = 2.4, edgeHeight = 2.0;
    const layers = [[handle, 0, gripHeight], [support, gripHeight, height - edgeHeight], [tip, height - edgeHeight, height]];
    const solids = layers.map(([outline, bottom, top]) =>
      keep(keep(ring(outline).extrude(top - bottom)).translate([-min[0], -min[1], bottom])));
    const solid = keep(Manifold.union(solids));
    const pieces = solid.decompose().map(keep);
    if (pieces.length !== 1 || !(solid.volume() > 0)) {
      throw Error('The grip, wall, and cutting edge could not join. Increase the size or smooth the outline.');
    }
    const {buffer, triangles} = binarySTL(solid, 'CoasterPrint cookie cutter; units mm');
    return {buffer, triangles, issues, width, height: footprintHeight, depth: height,
      cookieWidth: spanX * scale, cookieHeight: spanY * scale};
  } finally {
    for (const object of owned.reverse()) object.delete();
  }
}

self.onmessage = async ({data}) => {
  try {
    const result = await build(data);
    self.postMessage(result, result.buffer ? [result.buffer] : []);
  } catch (error) {
    self.postMessage({error: error.message || 'The cutter could not be built. Try more smoothing.'});
  }
};
