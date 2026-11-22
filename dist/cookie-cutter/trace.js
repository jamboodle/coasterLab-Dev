export function starSample() {
  const canvas = Object.assign(document.createElement('canvas'), {width: 340, height: 340});
  const context = canvas.getContext('2d');
  context.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * 36 - 90) * Math.PI / 180;
    const radius = i % 2 ? 68 : 148;
    context.lineTo(170 + radius * Math.cos(angle), 177 + radius * Math.sin(angle));
  }
  context.closePath();
  context.fillStyle = '#ed9aba';
  context.fill();
  context.fillStyle = '#522840';
  context.beginPath();
  context.arc(151, 156, 12, 0, 2 * Math.PI);
  context.fill();
  context.strokeStyle = context.fillStyle;
  context.lineWidth = 9;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(154, 195);
  context.quadraticCurveTo(176, 216, 199, 181);
  context.stroke();
  return canvas;
}

export function usesTransparency({data}) {
  return data.some((value, index) => index % 4 === 3 && value < 128);
}

function traceMask(image, useAlpha, threshold, invert, smoothing, pathContours, includeHoles) {
  const {width, height, data} = image;
  const binary = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    const foreground = data[i + 3] >= 128 && (useAlpha || (invert ? brightness > threshold : brightness <= threshold));
    binary[i] = binary[i + 1] = binary[i + 2] = foreground ? 0 : 255;
    binary[i + 3] = 255;
  }
  const {layers} = globalThis.ImageTracer.imagedataToTracedata({width, height, data: binary}, {
    pal: [{r: 0, g: 0, b: 0, a: 255}, {r: 255, g: 255, b: 255, a: 255}],
    colorquantcycles: 1, pathomit: 12, ltres: smoothing, qtres: smoothing, rightangleenhance: smoothing < 1
  });
  return flattenPaths(layers[0], pathContours, includeHoles);
}

function flattenPaths(paths, pathContours, includeHoles) {
  return paths.filter(path => (includeHoles || !path.isholepath) && path.segments.length).map(({segments}) => {
    const start = segments[0];
    const svg = 'M ' + start.x1 + ' ' + start.y1 + ' ' + segments.map(s =>
      s.type + ' ' + s.x2 + ' ' + s.y2 + (s.type === 'Q' ? ' ' + s.x3 + ' ' + s.y3 : '')).join(' ') + ' Z';
    return pathContours(svg, 1, 0.16)[0]?.map(([x, y]) => [x, -y]);
  }).filter(points => points?.length >= 3);
}

export function detectColorBoundaries(image, colors, smoothing, pathContours) {
  const {width, height, data} = image;
  const {palette, labels, transparent} = globalThis.alphaPalette(data, 'color', colors, 0);
  const cleaned = globalThis.cleanLabels(labels, width, height);
  const pixels = new Uint8ClampedArray(data.length);
  // Encode the labels as exact opaque colors for ImageTracer, including the transparent label.
  const tracePalette = palette.map((_, index) => ({r: index * 16, g: 0, b: 0, a: 255}));
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] === transparent || cleaned[i] === transparent ? labels[i] : cleaned[i];
    pixels[i * 4] = tracePalette[label].r;
    pixels[i * 4 + 3] = 255;
  }
  const {layers} = globalThis.ImageTracer.imagedataToTracedata({width, height, data: pixels}, {
    pal: tracePalette, colorquantcycles: 1, pathomit: 14, ltres: smoothing,
    qtres: smoothing, rightangleenhance: smoothing < 1
  });
  const paths = layers.flatMap((layer, index) => index === transparent ? [] : flattenPaths(layer, pathContours, true));
  return limitDetail(paths, 'Choose fewer outline colors or increase trace smoothing.');
}

export function detectOutlines(image, transparent, threshold, invert, smoothing, pathContours) {
  return traceMask(image, transparent, threshold, invert, smoothing, pathContours, false)
    .sort((a, b) => area(b) - area(a)).slice(0, 80);
}

export function detectStamp(image, threshold, invert, smoothing, pathContours) {
  const detail = traceMask(image, false, threshold, invert, smoothing, pathContours, true);
  return limitDetail(detail, 'Adjust the stamp threshold or increase trace smoothing.');
}

function limitDetail(paths, hint) {
  if (paths.reduce((count, points) => count + points.length, 0) > 15000) {
    throw Error('The stamp has too much detail. ' + hint);
  }
  return paths;
}

export function area(points) {
  return Math.abs(points.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return sum + x * nextY - y * nextX;
  }, 0)) / 2;
}
