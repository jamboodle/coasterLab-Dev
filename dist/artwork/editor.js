const $ = id => document.getElementById(id);
const maxSide = 1536;
const historyLimit = 9;

function canvas(width, height) {
  return Object.assign(document.createElement('canvas'), {width, height});
}

const fonts = new Map([
  ['system-ui', 'System sans'],
  ['Arial, sans-serif', 'Arial'],
  ['Georgia, serif', 'Georgia'],
  ['"Times New Roman", serif', 'Times New Roman'],
  ['"Courier New", monospace', 'Courier New']
]);
const layouts = new Map([['straight', 'Straight'], ['arc', 'Arc'], ['wave', 'Wave']]);
const graphemes = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

function imageColors(image) {
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const sample = canvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = sample.getContext('2d', {willReadFrequently: true});
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, sample.width, sample.height);
  const {data} = context.getImageData(0, 0, sample.width, sample.height);
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) bin.weight += data[i + 3];
    else bins.set(key, {weight: data[i + 3], rgb: (r << 16) | (g << 8) | b});
  }
  return [...bins.values()].sort((a, b) => b.weight - a.weight).slice(0, 16)
    .map(({rgb}) => '#' + rgb.toString(16).padStart(6, '0'));
}

function styleColor(element, color) {
  const rgb = Number.parseInt(color.slice(1), 16);
  const lightness = 0.299 * (rgb >> 16) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255);
  element.style.backgroundColor = color;
  element.style.color = lightness > 150 ? '#191919' : '#ffffff';
}

function colorOptions(select, colors) {
  select.classList.add('image-color');
  select.replaceChildren(...colors.map(color => {
    const option = new Option(color, color);
    styleColor(option, color);
    return option;
  }));
}

function drawText(context, block, size) {
  context.font = `bold ${size}px ${block.font}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (block.layout === 'straight' || !block.curve) {
    context.fillText(block.value, 0, 0);
    return;
  }
  const letters = Array.from(graphemes.segment(block.value), item => item.segment);
  const widths = letters.map(letter => context.measureText(letter).width);
  const width = widths.reduce((sum, advance) => sum + advance, 0);
  if (!width) return;
  const arc = block.layout === 'arc';
  const bend = block.curve / 100;
  const sweep = bend * Math.PI * 0.92;
  const radius = width / sweep;
  const amplitude = bend * Math.min(size * 0.8, width / 8);
  let advance = -width / 2;
  for (const [i, letter] of letters.entries()) {
    const offset = advance + widths[i] / 2;
    advance += widths[i];
    const angle = offset / width * (arc ? sweep : 2 * Math.PI);
    context.save();
    if (arc) {
      context.translate(radius * Math.sin(angle), radius * (1 - Math.cos(angle)));
      context.rotate(angle);
    } else {
      context.translate(offset, amplitude * Math.sin(angle));
      context.rotate(Math.atan(amplitude * 2 * Math.PI / width * Math.cos(angle)));
    }
    context.fillText(letter, 0, 0);
    context.restore();
  }
}

function fill(context, x, y, color) {
  const {width, height} = context.canvas;
  const image = context.getImageData(0, 0, width, height);
  const {data} = image;
  const start = Math.floor(y) * width + Math.floor(x);
  const target = data.slice(start * 4, start * 4 + 4);
  const rgb = Number.parseInt(color.slice(1), 16);
  const replacement = [rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255];
  if (target.every((value, index) => value === replacement[index])) return false;

  const queue = new Int32Array(width * height);
  const seen = new Uint8Array(queue.length);
  let count = 0;
  function enqueue(pixel) {
    if (seen[pixel]) return;
    seen[pixel] = 1;
    const offset = pixel * 4;
    if (target.some((value, index) => Math.abs(value - data[offset + index]) > 24)) return;
    data.set(replacement, offset);
    queue[count++] = pixel;
  }
  enqueue(start);
  for (let i = 0; i < count; i++) {
    const pixel = queue[i];
    const column = pixel % width;
    if (column > 0) enqueue(pixel - 1);
    if (column < width - 1) enqueue(pixel + 1);
    if (pixel >= width) enqueue(pixel - width);
    if (pixel + width < queue.length) enqueue(pixel + width);
  }
  context.putImageData(image, 0, 0);
  return true;
}

export async function createEditor(blob) {
  const image = await createImageBitmap(blob);
  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
  const original = canvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
  let colors;
  try {
    colors = imageColors(image);
    original.getContext('2d').drawImage(image, 0, 0, original.width, original.height);
  } finally {
    image.close();
  }

  const ink = $('ink');
  colorOptions(ink, colors);
  ink.disabled = colors.length === 0;
  if (colors.length) {
    ink.value = colors[1] ?? colors[0];
    styleColor(ink, ink.value);
  } else {
    ink.add(new Option('No visible colors', ''));
    ink.style.backgroundColor = ink.style.color = '';
  }
  ink.onchange = () => styleColor(ink, ink.value);
  const preview = $('preview');
  const output = preview.getContext('2d');
  const history = [{raster: original, text: []}];
  let cursor = 0;
  let state = history[cursor];
  let tool = colors.length ? 'paint' : 'erase';
  let stroke;
  let draft;

  function draw() {
    const {raster, text} = draft || state;
    if (preview.width !== raster.width || preview.height !== raster.height) {
      preview.width = raster.width;
      preview.height = raster.height;
    }
    output.clearRect(0, 0, raster.width, raster.height);
    output.drawImage(raster, 0, 0);
    for (const block of text) {
      output.save();
      output.translate(block.x * raster.width / 100, block.y * raster.height / 100);
      output.transform(...block.matrix, 0, 0);
      output.fillStyle = block.color;
      const size = Math.max(1, block.size * Math.min(raster.width, raster.height) / 100);
      drawText(output, block, size);
      output.restore();
    }
  }

  function updateButtons() {
    $('undo').disabled = cursor === 0;
    $('redo').disabled = cursor === history.length - 1;
    $('add-text').disabled = !colors.length || state.text.length >= 3;
  }

  function commit(next) {
    history.splice(cursor + 1);
    history.push(next);
    if (history.length > historyLimit) history.shift();
    cursor = history.length - 1;
    state = next;
    draft = null;
    draw();
    updateButtons();
  }

  function showTextControls() {
    const rows = state.text.map((block, index) => {
      const row = document.createElement('div');
      row.className = 'text-controls';
      function field(label, key, type, {min, max, options} = {}) {
        const wrapper = document.createElement('label');
        const input = document.createElement(type === 'select' ? 'select' : 'input');
        if (type !== 'select') input.type = type;
        if (options) for (const [value, name] of options) input.add(new Option(name, value));
        if (key === 'color') colorOptions(input, colors);
        input.setAttribute('aria-label', label + (key === 'value' ? '' : ' for text block ' + (index + 1)));
        if (type === 'range') {
          input.min = min;
          input.max = max;
        }
        if (type === 'text') input.maxLength = 80;
        input.value = block[key];
        if (key === 'color') styleColor(input, input.value);
        function next() {
          const value = type === 'range' ? input.valueAsNumber : input.value;
          return {...state, text: state.text.map((item, i) => i === index ? {...item, [key]: value} : item)};
        }
        input.oninput = () => {
          draft = next();
          draw();
        };
        input.onchange = () => {
          commit(next());
          if (key === 'color') styleColor(input, input.value);
          if (key === 'layout') curve.hidden = input.value === 'straight';
        };
        wrapper.append(label, input);
        row.append(wrapper);
        return wrapper;
      }
      field('Text block ' + (index + 1), 'value', 'text');
      field('Color', 'color', 'select');
      field('Font', 'font', 'select', {options: fonts});
      field('Layout', 'layout', 'select', {options: layouts});
      const curve = field('Curve', 'curve', 'range', {min: -100, max: 100});
      curve.hidden = block.layout === 'straight';
      field('Size', 'size', 'range', {min: 2, max: 35});
      field('Horizontal', 'x', 'range', {min: 0, max: 100});
      field('Vertical', 'y', 'range', {min: 0, max: 100});
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove text block ' + (index + 1));
      remove.onclick = () => {
        commit({...state, text: state.text.filter((_, i) => i !== index)});
        showTextControls();
        $('add-text').focus();
      };
      row.append(remove);
      return row;
    });
    $('text-blocks').replaceChildren(...rows);
  }

  function moveHistory(amount) {
    if (stroke || !history[cursor + amount]) return;
    cursor += amount;
    state = history[cursor];
    draft = null;
    draw();
    showTextControls();
    updateButtons();
  }

  function transform(kind) {
    if (stroke) return;
    const {raster, text} = state;
    const rotate = kind === 'rotate';
    const next = canvas(rotate ? raster.height : raster.width, rotate ? raster.width : raster.height);
    const context = next.getContext('2d');
    context.translate(next.width / 2, next.height / 2);
    if (rotate) context.rotate(Math.PI / 2);
    else context.scale(kind === 'horizontal' ? -1 : 1, kind === 'vertical' ? -1 : 1);
    context.drawImage(raster, -raster.width / 2, -raster.height / 2);
    const blocks = text.map(block => {
      const {x, y, matrix: [a, b, c, d]} = block;
      if (rotate) return {...block, x: 100 - y, y: x, matrix: [-b, a, -d, c]};
      if (kind === 'horizontal') return {...block, x: 100 - x, matrix: [-a, b, -c, d]};
      return {...block, y: 100 - y, matrix: [a, -b, c, -d]};
    });
    commit({raster: next, text: blocks});
    showTextControls();
  }

  function point(event) {
    const rect = preview.getBoundingClientRect();
    return [
      Math.max(0, Math.min(preview.width - 1, (event.clientX - rect.left) * preview.width / rect.width)),
      Math.max(0, Math.min(preview.height - 1, (event.clientY - rect.top) * preview.height / rect.height))
    ];
  }

  function paint(to) {
    const {context, from, size} = stroke;
    context.beginPath();
    if (from) {
      context.moveTo(...from);
      context.lineTo(...to);
      context.stroke();
    } else {
      context.arc(...to, size / 2, 0, 2 * Math.PI);
      context.fill();
    }
    stroke.from = to;
    draw();
  }

  preview.onpointerdown = event => {
    if (event.button !== 0 || stroke) return;
    if (draft) commit(draft);
    const start = point(event);
    const raster = canvas(preview.width, preview.height);
    const context = raster.getContext('2d', {willReadFrequently: tool === 'fill'});
    context.drawImage(state.raster, 0, 0);
    const next = {...state, raster};
    if (tool === 'fill') {
      if (fill(context, ...start, ink.value)) commit(next);
      return;
    }
    const size = $('brush').valueAsNumber;
    context.lineWidth = size;
    context.lineCap = 'round';
    context.strokeStyle = context.fillStyle = ink.value;
    if (tool === 'erase') context.globalCompositeOperation = 'destination-out';
    draft = next;
    stroke = {context, size, id: event.pointerId};
    preview.setPointerCapture(event.pointerId);
    paint(start);
  };
  preview.onpointermove = event => {
    if (stroke?.id === event.pointerId) paint(point(event));
  };
  function end(event) {
    if (stroke?.id !== event.pointerId) return;
    if (event.type === 'pointerup') paint(point(event));
    stroke = null;
    commit(draft);
  }
  preview.onpointerup = preview.onpointercancel = preview.onlostpointercapture = end;

  const tools = [...document.querySelectorAll('[data-tool]')];
  for (const button of tools) {
    button.disabled = !colors.length && button.dataset.tool !== 'erase';
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    button.onclick = () => {
      tool = button.dataset.tool;
      for (const control of tools) control.setAttribute('aria-pressed', String(control === button));
    };
  }
  $('undo').onclick = () => moveHistory(-1);
  $('redo').onclick = () => moveHistory(1);
  $('rotate').onclick = () => transform('rotate');
  $('flip').onclick = () => transform('horizontal');
  $('flip-vertical').onclick = () => transform('vertical');
  $('add-text').onclick = () => {
    if (!colors.length || state.text.length >= 3 || stroke) return;
    commit({...state, text: [...state.text, {
      value: '', color: ink.value, font: 'system-ui', layout: 'straight', curve: 55, size: 12, x: 50, y: 30 + 20 * state.text.length, matrix: [1, 0, 0, 1]
    }]});
    showTextControls();
    $('text-blocks').lastElementChild.querySelector('input').focus();
  };
  $('text-blocks').parentElement.open = false;
  draw();
  showTextControls();
  updateButtons();
  return {
    export: () => new Promise((resolve, reject) => {
      preview.toBlob(file => file ? resolve(file) : reject(Error('Could not export artwork. Try again.')), 'image/png');
    })
  };
}
