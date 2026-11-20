import Module from '../vendor/manifold.js';

const lipDepth = 0.8;
const retention = 0.65;
const loopRadius = 4.5;
const loopRise = 2.9;
const model = Module({locateFile: name => new URL('../vendor/' + name, import.meta.url).href})
  .then(module => { module.setup(); return module; });
// Follow the deployed maker's content-hashed STL writer and mesh validator.
const stl = fetch('../asset-manifest.json').then(response => response.json())
  .then(manifest => import('/' + manifest.scripts['stl-geometry.js']));

function tracedSections(trace, pitch) {
  const {labels, width, height, bounds} = trace;
  const sections = new Map();
  let complexity = 0;
  for (let y = bounds.minY; y < bounds.maxY; y++) {
    let x = bounds.minX;
    while (x < bounds.maxX) {
      const id = labels[y * width + x];
      const left = x++;
      while (x < bounds.maxX && labels[y * width + x] === id) x++;
      if (!id) continue;
      if (++complexity > 17000) throw Error('This trace has too much detail. Increase smoothing or use simpler artwork.');
      const x0 = (left - bounds.minX) * pitch, x1 = (x - bounds.minX) * pitch;
      const y0 = (height - y - 1 - (height - bounds.maxY)) * pitch, y1 = y0 + pitch;
      if (!sections.has(id)) sections.set(id, []);
      sections.get(id).push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    }
  }
  return sections;
}

function topAnchor(trace) {
  const {labels, width, bounds} = trace;
  const midpoint = (bounds.minX + bounds.maxX) / 2;
  let anchor, distance = Infinity;
  for (let x = bounds.minX; x < bounds.maxX; x++) {
    if (labels[bounds.minY * width + x] !== -1) continue;
    const next = Math.abs(x + 0.5 - midpoint);
    if (next < distance) {
      anchor = x + 0.5 - bounds.minX;
      distance = next;
    }
  }
  return anchor ?? (bounds.maxX - bounds.minX) / 2;
}

function artworkPitch(settings, width, height, anchor) {
  if (settings.axis === 'height') {
    return (settings.size - (settings.loop ? loopRise + loopRadius : 0)) / height;
  }
  const pitch = settings.size / width;
  if (!settings.loop) return pitch;
  // The loop can project beyond the artwork on the left or right.
  return Math.min(pitch, (settings.size - loopRadius) / Math.max(anchor, width - anchor));
}

async function build(trace, settings, assignments) {
  const [{CrossSection, Manifold}, {binarySTL}] = await Promise.all([model, stl]);
  const owned = [];
  const keep = value => { owned.push(value); return value; };
  const problems = [], warnings = [], dropped = [], inserts = [];
  const split = shape => shape.decompose().map(keep);
  const cross = contours => keep(new CrossSection(contours, 'NonZero'));
  const offset = (shape, amount) => keep(shape.offset(amount, 'Round', 2, 16));

  function part(shape, thickness, name, mirrorX) {
    return file(keep(shape.extrude(thickness)), name, mirrorX);
  }

  function file(solid, name, mirrorX) {
    const previewBounds = solid.boundingBox();
    // The lip faces the print bed. Mirror the print coordinates so that the
    // finished front is the same way around as the original artwork.
    if (mirrorX !== undefined) solid = keep(keep(solid.mirror([1, 0, 0])).translate([mirrorX, 0, 0]));
    if (split(solid).length !== 1) throw Error('The solid has disconnected sections.');
    const cleaned = keep(keep(solid.asOriginal()).setTolerance(0.0001));
    const {buffer} = binarySTL(cleaned, name + '; units mm');
    return {name, buffer, bounds: solid.boundingBox(), previewBounds};
  }

  function seat(region) {
    const insert = settings.clearance ? offset(region, -settings.clearance) : region;
    const opening = offset(region, -(settings.clearance + retention));
    const insertCore = insert.isEmpty() ? insert : offset(insert, -0.37);
    if (insert.isEmpty() || insert.area() < 2 || split(insert).length !== 1 ||
        insertCore.isEmpty() || split(insertCore).length !== 1 || opening.isEmpty() ||
        opening.area() < 1 || split(opening).length !== 1) return null;
    return {insert, rim: keep(region.subtract(opening))};
  }

  function frameSolid(body, front) {
    const lip = keep(front.extrude(lipDepth));
    const walls = keep(keep(body.extrude(settings.frame - lipDepth)).translate([0, 0, lipDepth]));
    return keep(Manifold.union([lip, walls]));
  }

  function coupon() {
    try {
      const outer = keep(CrossSection.square([18, 14]));
      const pocket = keep(keep(CrossSection.square([12, 8])).translate([3, 3]));
      const body = keep(outer.subtract(pocket));
      const fit = seat(pocket);
      return [file(frameSolid(body, keep(body.add(fit.rim))), 'fit-coupon-frame'),
        part(fit.insert, settings.insert, 'fit-coupon-insert')];
    } catch (error) {
      warnings.push('Fit coupon could not be generated: ' + error.message);
      return [];
    }
  }

  try {
    if (trace.regions.length > 150) throw Error('More than 150 regions were detected. Simplify the artwork or adjust the trace.');
    const {minX, maxX, minY, maxY} = trace.bounds;
    const width = maxX - minX, height = maxY - minY;
    const anchor = topAnchor(trace);
    const pitch = artworkPitch(settings, width, height, anchor);
    const mirrorX = width * pitch;
    const sections = tracedSections(trace, pitch);
    let body = cross(sections.get(-1));
    const components = split(body).sort((a, b) => b.area() - a.area());
    const detached = components.slice(1).flatMap(section => section.toPolygons());
    if (components.length !== 1) problems.push(`The frame has ${components.length} disconnected sections. Join the lines in the artwork or try Close gaps.`);
    if (!trace.regions.length) problems.push('No closed regions. Close the outlines in the artwork or adjust the trace.');
    if (trace.leaking) warnings.push('Some areas may be open to the outside. Check the amber areas in the trace.');
    const inner = offset(body, -0.42);
    const thin = inner.isEmpty() ? body : keep(body.subtract(offset(inner, 0.42)));
    const thinParts = split(thin).filter(shape => shape.area() >= 0.35);
    if (thinParts.length) warnings.push('Red frame areas are under about 0.84 mm wide. Increase the size or thicken those lines before printing.');
    if (settings.loop) {
      const center = [anchor * pitch, height * pitch + loopRise];
      const outer = keep(keep(CrossSection.circle(loopRadius, 48)).translate(center));
      const hole = keep(keep(CrossSection.circle(2.3, 36)).translate(center));
      body = keep(body.add(keep(outer.subtract(hole))));
      if (split(body).length > components.length) problems.push('The hanging loop did not join the frame. Close gaps, thicken the top outline, or turn the loop off.');
    }

    const rims = [body];
    for (const {id} of trace.regions) {
      const assignment = assignments[id];
      if (assignment.open) continue;
      const region = cross(sections.get(id));
      const fit = seat(region);
      if (!fit) {
        dropped.push({id, polygons: region.toPolygons()});
        continue;
      }
      const name = 'insert-' + String(id).padStart(2, '0');
      try {
        const printable = part(fit.insert, settings.insert, name, mirrorX);
        rims.push(fit.rim);
        inserts.push({...printable, id, color: assignment.color, polygons: fit.insert.toPolygons()});
      } catch (error) {
        dropped.push({id, polygons: region.toPolygons()});
        warnings.push(`Insert ${id}: ${error.message}`);
      }
    }
    if (dropped.length) warnings.push('These inserts were too small, split, or lost their opening at this size or clearance: ' +
      dropped.map(part => part.id).join(', ') + '. They are left open in the frame.');
    const front = keep(CrossSection.union(rims));
    const footprint = front.bounds();
    if ([0, 1].some(axis => footprint.max[axis] - footprint.min[axis] > 256)) {
      warnings.push('The frame footprint exceeds the Bambu P1S nominal 256 mm bed. Reduce the size before printing on that printer.');
    }
    let frame;
    if (!problems.length) {
      try {
        frame = file(frameSolid(body, front), 'suncatcher-frame', mirrorX);
      } catch (error) {
        problems.push('Frame cannot be exported: ' + error.message + ' Try increasing smoothing or changing the trace.');
      }
    }
    return {
      frame, inserts, dropped, problems, warnings, footprint, pitch,
      front: front.toPolygons(), detached, thin: thinParts.flatMap(shape => shape.toPolygons()),
      coupon: coupon()
    };
  } finally {
    for (const object of owned.reverse()) object.delete();
  }
}

self.onmessage = async ({data: {id, trace, settings, assignments}}) => {
  try {
    const result = await build(trace, settings, assignments);
    const parts = [result.frame, ...result.inserts, ...result.coupon].filter(Boolean);
    self.postMessage({id, result}, parts.map(part => part.buffer));
  } catch (error) {
    self.postMessage({id, error: error.message || String(error)});
  }
};
