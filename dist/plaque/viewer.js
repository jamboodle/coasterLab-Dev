const vertexSource = `
  attribute vec3 position;
  attribute vec3 normal;
  uniform vec3 center;
  uniform vec2 yaw;
  uniform vec2 pitch;
  uniform vec3 scale;
  varying float light;
  vec3 orbit(vec3 point) {
    vec3 a = vec3(yaw.x * point.x - yaw.y * point.y, yaw.y * point.x + yaw.x * point.y, point.z);
    return vec3(a.x, pitch.x * a.y - pitch.y * a.z, pitch.y * a.y + pitch.x * a.z);
  }
  void main() {
    vec3 p = orbit(position - center);
    gl_Position = vec4(p * scale, 1.0);
    light = 0.50 + 0.50 * max(0.0, dot(orbit(normal), normalize(vec3(-0.35, 0.65, 1.0))));
  }`;

const fragmentSource = `
  precision mediump float;
  uniform vec3 color;
  varying float light;
  void main() { gl_FragColor = vec4(color * light, 1.0); }`;

function compile(gl, kind, source) {
  const shader = gl.createShader(kind);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('3D shader could not compile.');
  return shader;
}

function meshData(buffer) {
  const stl = new DataView(buffer);
  const triangles = stl.getUint32(80, true);
  const data = new Float32Array(triangles * 18);
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + 50 * i;
    const nx = stl.getFloat32(offset, true), ny = stl.getFloat32(offset + 4, true), nz = stl.getFloat32(offset + 8, true);
    for (let v = 0; v < 3; v++) {
      const start = i * 18 + v * 6, vertex = offset + 12 + v * 12;
      data[start] = stl.getFloat32(vertex, true);
      data[start + 1] = stl.getFloat32(vertex + 4, true);
      data[start + 2] = stl.getFloat32(vertex + 8, true);
      data[start + 3] = nx;
      data[start + 4] = ny;
      data[start + 5] = nz;
    }
  }
  return data;
}

export function createViewer(canvas, onLost) {
  const gl = canvas.getContext('webgl', {antialias: true, alpha: false});
  if (!gl) return null;
  const program = gl.createProgram();
  const vert = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  const location = Object.fromEntries(['center', 'yaw', 'pitch', 'scale', 'color']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  const position = gl.getAttribLocation(program, 'position'), normal = gl.getAttribLocation(program, 'normal');
  let yaw = -0.25, pitch = 0.75, zoom = 1, meshes = [], model, pointer, frame;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };

  function draw() {
    frame = undefined;
    if (!model || gl.isContextLost() || canvas.hidden) return;
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.94, 0.92, 0.88, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    const radius = Math.hypot(model.width, model.height, model.depth) / 2;
    const amount = 0.91 * zoom / radius;
    gl.uniform3f(location.center, model.width / 2, model.height / 2, model.depth / 2);
    gl.uniform2f(location.yaw, Math.cos(yaw), Math.sin(yaw));
    gl.uniform2f(location.pitch, Math.cos(pitch), Math.sin(pitch));
    gl.uniform3f(location.scale, amount * Math.min(1, height / width), amount * Math.min(1, width / height), -0.95 / radius);
    for (const item of meshes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
      gl.enableVertexAttribArray(position);
      gl.enableVertexAttribArray(normal);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
      gl.uniform3fv(location.color, item.color);
      gl.drawArrays(gl.TRIANGLES, 0, item.count);
    }
  }

  function clear() {
    for (const item of meshes) gl.deleteBuffer(item.buffer);
    meshes = [];
    model = undefined;
  }

  function reset() {
    yaw = -0.25;
    pitch = 0.75;
    zoom = 1;
    schedule();
  }

  function zoomBy(factor) {
    zoom = Math.max(0.55, Math.min(4, zoom * factor));
    schedule();
  }

  new ResizeObserver(schedule).observe(canvas);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('pointerdown', event => {
    if (!model || pointer || event.button !== 0) return;
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
    canvas.setPointerCapture(pointer.id);
  });
  canvas.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    yaw += (event.clientX - pointer.x) * 0.012;
    pitch += (event.clientY - pointer.y) * 0.012;
    pointer = {id: pointer.id, x: event.clientX, y: event.clientY};
    schedule();
  });
  canvas.addEventListener('lostpointercapture', () => { pointer = undefined; });
  canvas.addEventListener('wheel', event => {
    if (!model) return;
    event.preventDefault();
    zoomBy(Math.exp(-event.deltaY * 0.002));
  }, {passive: false});
  const keys = {
    ArrowLeft: () => { yaw -= 0.13; }, ArrowRight: () => { yaw += 0.13; },
    ArrowUp: () => { pitch -= 0.13; }, ArrowDown: () => { pitch += 0.13; },
    '+': () => zoomBy(1.2), '=': () => zoomBy(1.2), '-': () => zoomBy(1 / 1.2), Home: reset
  };
  canvas.addEventListener('keydown', event => {
    if (!model || !Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    keys[event.key]();
    schedule();
  });

  return {
    clear, reset, zoomBy,
    show(result) {
      if (gl.isContextLost()) return false;
      clear();
      model = result;
      for (const part of result.parts) {
        const data = meshData(part.buffer), buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const color = [1, 3, 5].map(i => parseInt(part.color.slice(i, i + 2), 16) / 255);
        meshes.push({buffer, count: data.length / 6, color});
      }
      reset();
      return true;
    }
  };
}
