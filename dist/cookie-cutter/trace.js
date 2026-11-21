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
  context.fillStyle = '#9d3c63';
  context.fill();
  return canvas;
}

export function usesTransparency({data}) {
  return data.some((value, index) => index % 4 === 3 && value < 128);
}

export function detectOutlines(image, transparent, threshold, invert, smoothing, pathContours) {
  const {width, height, data} = image;
  const binary = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    const foreground = transparent ? data[i + 3] >= 128 : (invert ? brightness > threshold : brightness <= threshold);
    binary[i] = binary[i + 1] = binary[i + 2] = foreground ? 0 : 255;
    binary[i + 3] = 255;
  }
  const {layers} = window.ImageTracer.imagedataToTracedata({width, height, data: binary}, {
    pal: [{r: 0, g: 0, b: 0, a: 255}, {r: 255, g: 255, b: 255, a: 255}],
    colorquantcycles: 1, pathomit: 12, ltres: smoothing, qtres: smoothing, rightangleenhance: smoothing < 1
  });
  return layers[0].filter(path => !path.isholepath && path.segments.length).map(({segments}) => {
    const start = segments[0];
    const svg = 'M ' + start.x1 + ' ' + start.y1 + ' ' + segments.map(s =>
      s.type + ' ' + s.x2 + ' ' + s.y2 + (s.type === 'Q' ? ' ' + s.x3 + ' ' + s.y3 : '')).join(' ') + ' Z';
    return pathContours(svg, 1, 0.16)[0]?.map(([x, y]) => [x, -y]);
  }).filter(points => points?.length >= 3).sort((a, b) => area(b) - area(a)).slice(0, 80);
}

export function area(points) {
  return Math.abs(points.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return sum + x * nextY - y * nextX;
  }, 0)) / 2;
}
