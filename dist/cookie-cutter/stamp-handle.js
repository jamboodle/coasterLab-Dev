export const backingHeight = 11;
const pitch = 2.4;
const rootRadius = 3.8;
const threadHeight = 0.85;
const clearance = 0.35;
const postHeight = 7.2;
const socketDepth = 8.4;
const socketRadius = rootRadius + threadHeight + clearance;
const circle = 2 * Math.PI;

function thread(kernel, keep, socket) {
  const start = socket ? -0.25 : -0.15;
  const end = socket ? socketDepth : postHeight;
  const slices = Math.ceil((end - start) / 0.075);
  const sectors = 96;
  const vertices = [], triangles = [];
  for (let slice = 0; slice <= slices; slice++) {
    const z = start + (end - start) * slice / slices;
    for (let sector = 0; sector < sectors; sector++) {
      const turn = sector / sectors;
      const phase = z / pitch - turn;
      const ridge = Math.max(0, Math.min(1, (0.43 - Math.abs(phase - Math.round(phase))) / 0.32));
      const lead = socket ? 1 : Math.max(0, Math.min(1, (end - z) / 0.9));
      const radius = socket
        ? Math.max(rootRadius + clearance + threadHeight * ridge, socketRadius - 1.3 * Math.max(0, z))
        : rootRadius - 0.45 * (1 - lead) + threadHeight * ridge * lead;
      vertices.push(radius * Math.cos(circle * turn), radius * Math.sin(circle * turn), z);
      if (slice < slices) {
        const a = slice * sectors + sector;
        const b = slice * sectors + (sector + 1) % sectors;
        triangles.push(a, b, a + sectors, b, b + sectors, a + sectors);
      }
    }
  }
  const bottom = vertices.length / 3, top = bottom + 1;
  vertices.push(0, 0, start, 0, 0, end);
  for (let i = 0; i < sectors; i++) {
    const next = (i + 1) % sectors, endRing = slices * sectors;
    triangles.push(bottom, next, i, top, endRing + i, endRing + next);
  }
  const solid = keep(kernel.Manifold.ofMesh(new kernel.Mesh({
    numProp: 3, vertProperties: new Float32Array(vertices), triVerts: new Uint32Array(triangles)
  })));
  if (solid.status() !== 'NoError') throw Error('The stamp thread could not be generated.');
  return solid;
}

export function stampSocket(kernel, keep, backing) {
  const margin = 1.7;
  const space = keep(backing.offset(-(socketRadius + margin), 'Round', 2, 40));
  if (space.isEmpty()) throw Error('The stamp needs a wider area for the threaded socket. Increase the cookie size or widen the outline.');
  const {CrossSection} = kernel;
  const {min, max} = backing.bounds();
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const probe = keep(CrossSection.circle(0.04, 8));
  const centered = keep(space.intersect(keep(probe.translate(center))));
  // The nearest safe point is on the eroded outline when the center falls in a notch.
  const location = centered.area() > probe.area() * 0.99 ? center :
    space.toPolygons().flat().reduce((closest, point) => {
      const distance = p => Math.hypot(p[0] - center[0], p[1] - center[1]);
      return distance(point) < distance(closest) ? point : closest;
    });
  return keep(thread(kernel, keep, true).translate([...location, 0]));
}

export function stampHandle(kernel, keep) {
  const {CrossSection, Manifold} = kernel;
  const outline = keep(keep(CrossSection.circle(17, 80)).translate([0, 14.5]));
  const floor = keep(keep(CrossSection.square([36, 33])).translate([-18, 0]));
  // A pointed top on the finger opening gives it a printable roof.
  const opening = Array.from({length: 37}, (_, index) => {
    const angle = circle * (135 + 270 * index / 36) / 360;
    return [11 * Math.cos(angle), 14 + 11 * Math.sin(angle)];
  });
  opening.push([0, 29.5]);
  const hole = keep(new CrossSection([opening], 'Positive'));
  const profile = keep(keep(outline.intersect(floor)).subtract(hole));
  const ring = keep(keep(profile.extrude(10)).rotate([90, 0, 0]));
  const collarHeight = 2.4, postStart = 32.4;
  const collar = keep(keep(Manifold.cylinder(collarHeight, 5.5, 5.5, 64)).translate([0, -5, postStart - collarHeight]));
  const post = keep(thread(kernel, keep, false).translate([0, -5, postStart]));
  const combined = keep(Manifold.union([ring, collar, post]));
  const {min, max} = combined.boundingBox();
  return {solid: keep(combined.translate(min.map(value => -value))),
    width: max[0] - min[0], height: max[1] - min[1], depth: max[2] - min[2]};
}
