const gridLimit = 420;
const padding = 7;

export async function decodeArtwork(file) {
  if (!/\.(png|jpe?g|svg)$/i.test(file.name)) throw Error('Choose a PNG, JPG or SVG file.');
  if (file.size > 20 * 1024 * 1024) throw Error('Choose a file smaller than 20 MB.');
  if (!/\.svg$/i.test(file.name)) return createImageBitmap(file);
  // Load SVG in image mode. It is never inserted as markup or loaded as a document.
  const svg = await file.text();
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw Error('This SVG is invalid.');
  const url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function flowerSample() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 360;
  const context = canvas.getContext('2d');
  context.translate(180, 180);
  context.lineWidth = 8;
  // Start independent subpaths so the two rings have no connecting stroke.
  context.beginPath();
  context.arc(0, 0, 155, 0, Math.PI * 2);
  context.moveTo(35, 0);
  context.arc(0, 0, 35, 0, Math.PI * 2);
  context.stroke();
  for (let i = 0; i < 6; i++) {
    context.beginPath();
    context.moveTo(0, -35);
    context.bezierCurveTo(9, -76, 60, -117, 0, -155);
    context.stroke();
    context.rotate(Math.PI / 3);
  }
  return canvas;
}

function morph(mask, width, height, radius, dilate) {
  for (let step = 0; step < radius; step++) {
    const next = new Uint8Array(mask.length);
    for (let y = 1; y < height - 1; y++) {
      for (let i = y * width + 1; i < (y + 1) * width - 1; i++) {
        next[i] = dilate ? mask[i] | mask[i - 1] | mask[i + 1] | mask[i - width] | mask[i + width] :
          mask[i] & mask[i - 1] & mask[i + 1] & mask[i - width] & mask[i + width];
      }
    }
    mask = next;
  }
  return mask;
}

function closeGaps(mask, width, height, radius) {
  return morph(morph(mask, width, height, radius, true), width, height, radius, false);
}

function labelRegions(mask, width) {
  const labels = Int32Array.from(mask, value => value ? -1 : -2);
  const queue = new Int32Array(mask.length);
  const regions = [];
  for (let start = 0; start < mask.length; start++) {
    if (labels[start] !== -2) continue;
    const id = start === 0 ? 0 : regions.length + 1;
    let length = 0, sumX = 0, sumY = 0;
    function visit(p) {
      if (labels[p] !== -2) return;
      labels[p] = id;
      queue[length++] = p;
    }
    visit(start);
    for (let i = 0; i < length; i++) {
      const p = queue[i], x = p % width;
      sumX += x;
      sumY += Math.floor(p / width);
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      visit(p - width);
      visit(p + width);
    }
    if (!id) continue;
    const x = sumX / length, y = sumY / length;
    let center = start, best = Infinity;
    for (let i = 0; i < length; i++) {
      const p = queue[i];
      const distance = (p % width - x) ** 2 + (Math.floor(p / width) - y) ** 2;
      if (distance < best) {
        best = distance;
        center = p;
      }
    }
    regions.push({id, area: length, x: center % width + 0.5, y: Math.floor(center / width) + 0.5});
  }
  return {labels, regions};
}

export function traceArtwork(image, threshold, smooth, gap) {
  const maximum = Math.max(image.width, image.height);
  if (!maximum || image.width * image.height > 80_000_000) throw Error('The image dimensions are unsupported. Resize the artwork and try again.');
  const imageWidth = Math.max(1, Math.round(image.width / maximum * gridLimit));
  const imageHeight = Math.max(1, Math.round(image.height / maximum * gridLimit));
  const width = imageWidth + 2 * padding, height = imageHeight + 2 * padding;
  const canvas = Object.assign(document.createElement('canvas'), {width, height});
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  if (smooth) context.filter = `blur(${smooth}px)`;
  context.drawImage(image, padding, padding, imageWidth, imageHeight);
  const {data} = context.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let y = padding; y < height - padding; y++) {
    for (let i = y * width + padding; i < (y + 1) * width - padding; i++) {
      const offset = i * 4;
      mask[i] = Number(data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722 < threshold);
    }
  }
  const closed = gap ? closeGaps(mask, width, height, gap) : mask;
  const trace = labelRegions(closed, width);
  const repaired = closeGaps(closed, width, height, Math.max(2, gap));
  const after = labelRegions(repaired, width);
  const leaks = new Uint8Array(mask.length);
  let leaking = 0, minX = width, minY = height, maxX = 0, maxY = 0;
  for (let i = 0; i < mask.length; i++) {
    if (closed[i]) {
      const x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
    }
    if (trace.labels[i] === 0 && after.labels[i] > 0 && after.regions[after.labels[i] - 1].area >= 12) {
      leaks[i] = 1;
      leaking++;
    }
  }
  if (minX >= maxX) throw Error('No dark outlines detected. Raise the threshold or choose higher-contrast artwork.');
  return {...trace, leaks, leaking, width, height, bounds: {minX, minY, maxX, maxY}};
}

export function matchAssignments(previous, next, oldAssignments, makeDefault) {
  const assignments = new Map();
  if (!previous || previous.width !== next.width || previous.height !== next.height) {
    for (const region of next.regions) assignments.set(region.id, makeDefault(region.id));
    return assignments;
  }
  const overlaps = next.regions.map(() => new Map());
  for (let i = 0; i < next.labels.length; i++) {
    const id = next.labels[i], old = previous.labels[i];
    if (id > 0 && old > 0) overlaps[id - 1].set(old, (overlaps[id - 1].get(old) || 0) + 1);
  }
  for (const region of next.regions) {
    let match, count = region.area * 0.35;
    for (const [old, pixels] of overlaps[region.id - 1]) {
      if (pixels > count) {
        match = old;
        count = pixels;
      }
    }
    assignments.set(region.id, oldAssignments.get(match) || makeDefault(region.id));
  }
  return assignments;
}
