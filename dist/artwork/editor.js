const $ = id => document.getElementById(id);
const maxSide = 1536;
const historyLimit = 9;

function canvas(width, height) {
  return Object.assign(document.createElement('canvas'), {width, height});
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
  try {
    original.getContext('2d').drawImage(image, 0, 0, original.width, original.height);
  } finally {
    image.close();
  }

  const preview = $('preview');
  const output = preview.getContext('2d');
  const history = [{raster: original, text: []}];
  let cursor = 0;
  let state = history[cursor];
  let tool = 'paint';
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
      output.font = `bold ${Math.max(1, block.size * Math.min(raster.width, raster.height) / 100)}px system-ui`;
      output.textAlign = 'center';
      output.textBaseline = 'middle';
      output.fillText(block.value, 0, 0);
      output.restore();
    }
  }

  function updateButtons() {
    $('undo').disabled = cursor === 0;
    $('redo').disabled = cursor === history.length - 1;
    $('add-text').disabled = state.text.length >= 3;
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
      function field(label, key, type, min, max) {
        const wrapper = document.createElement('label');
        const input = document.createElement('input');
        input.type = type;
        input.value = block[key];
        input.setAttribute('aria-label', label + (key === 'value' ? '' : ' for text block ' + (index + 1)));
        if (type === 'range') {
          input.min = min;
          input.max = max;
        }
        if (type === 'text') input.maxLength = 80;
        function next() {
          const value = type === 'range' ? input.valueAsNumber : input.value;
          return {...state, text: state.text.map((item, i) => i === index ? {...item, [key]: value} : item)};
        }
        input.oninput = () => {
          draft = next();
          draw();
        };
        input.onchange = () => commit(next());
        wrapper.append(label, input);
        row.append(wrapper);
      }
      field('Text block ' + (index + 1), 'value', 'text');
      field('Color', 'color', 'color');
      field('Size', 'size', 'range', 2, 35);
      field('Horizontal', 'x', 'range', 0, 100);
      field('Vertical', 'y', 'range', 0, 100);
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
      if (fill(context, ...start, $('ink').value)) commit(next);
      return;
    }
    const size = $('brush').valueAsNumber;
    context.lineWidth = size;
    context.lineCap = 'round';
    context.strokeStyle = context.fillStyle = $('ink').value;
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
    if (state.text.length >= 3 || stroke) return;
    commit({...state, text: [...state.text, {
      value: '', color: '#222222', size: 12, x: 50, y: 30 + 20 * state.text.length, matrix: [1, 0, 0, 1]
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
