'use strict';

window.coasterProActive = async function coasterProActive(signal) {
  try {
    const response = await fetch('/api/maker-access', {signal: signal || AbortSignal.timeout(10000)});
    return response.ok && (await response.json()).pro === true;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
};

window.proControlValues = function proControlValues(ids, values) {
  return Object.fromEntries(ids.map(id => {
    const control = document.getElementById(id);
    const property = control.type === 'checkbox' ? 'checked' : 'value';
    if (values && (property === 'checked' ? typeof values[id] === 'boolean' : typeof values[id] === 'string')) {
      control[property] = values[id];
    }
    return [id, control[property]];
  }));
};

function projectThumbnail(file) {
  return createImageBitmap(file).then(bitmap => {
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', {alpha: false});
      ctx.fillStyle = '#eee9df';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const thumbnail = canvas.toDataURL('image/jpeg', .76);
      return thumbnail.length <= 64000 ? thumbnail : undefined;
    } finally {bitmap.close();}
  }).catch(() => undefined);
}

function savedArtwork(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error('Could not read the artwork.'));
    reader.onload = () => {
      const mime = /\.png$/i.test(file.name) ? 'png' : 'jpeg';
      resolve({name: file.name, data: String(reader.result).replace(/^data:[^;,]*/, 'data:image/' + mime)});
    };
    reader.readAsDataURL(file);
  });
}

window.mountProLibrary = async function mountProLibrary({maker, anchor, settings, files, apply}) {
  if (!await window.coasterProActive()) return;
  const panel = document.createElement('div');
  panel.className = 'pro-library';
  panel.innerHTML = `
    <details class="pro-projects">
      <summary>Pro Projects</summary>
      <label>Project name <input type="text" maxlength="80"></label>
      <div class="pro-library-actions">
        <button type="button" data-action="save">Save new project</button>
        <button type="button" data-action="update" hidden>Save project changes</button>
      </div>
      <p role="status" aria-live="polite"></p>
      <h3>Saved projects</h3>
      <label>Find a project <input type="search" maxlength="80"></label>
      <p class="pro-project-empty"></p>
      <ul class="pro-project-grid"></ul>
    </details>
    <details class="pro-presets">
      <summary>Pro Presets</summary>
      <p>Save settings to reuse with other artwork.</p>
      <label>Preset name <input type="text" maxlength="80"></label>
      <div class="pro-library-actions">
        <button type="button" data-action="save">Save new preset</button>
      </div>
      <label>Saved presets <select><option value="">Choose a preset</option></select></label>
      <div class="pro-library-actions">
        <button type="button" data-action="open" disabled>Apply preset</button>
        <button type="button" data-action="update" disabled>Save preset changes</button>
        <button type="button" data-action="delete" disabled>Delete preset</button>
      </div>
      <p role="status" aria-live="polite"></p>
    </details>`;
  anchor.after(panel);
  const projects = panel.querySelector('.pro-projects');
  const presets = panel.querySelector('.pro-presets');
  const grid = projects.querySelector('ul');
  const search = projects.querySelector('[type=search]');
  const projectName = projects.querySelector('[type=text]');
  const presetName = presets.querySelector('[type=text]');
  const select = presets.querySelector('select');
  const endpoint = '/api/pro/library/' + maker;
  let entries = [], openProject, busy = false;

  async function request(suffix = '', payload) {
    const response = await fetch(endpoint + suffix, {signal: AbortSignal.timeout(60000), ...(payload && {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    })});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Could not access your Pro library.');
    return data;
  }

  function renderProjects() {
    const term = search.value.trim().toLowerCase();
    const matches = entries.filter(item => item.kind === 'project' && item.name.toLowerCase().includes(term));
    grid.replaceChildren();
    projects.querySelector('.pro-project-empty').textContent = matches.length ? '' :
      term ? 'No projects match your search.' : 'Save a project to see it here.';
    for (const item of matches) {
      const card = document.createElement('li');
      const preview = document.createElement('div');
      preview.className = 'pro-project-preview';
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = '';
      image.src = endpoint + '/' + item.id + '/thumbnail';
      image.onerror = () => {
        preview.textContent = 'Preview unavailable';
      };
      preview.append(image);
      const title = document.createElement('strong');
      title.textContent = item.name;
      const actions = document.createElement('div');
      actions.className = 'pro-library-actions';
      for (const [action, label] of [['open', 'Open project'], ['delete', 'Delete project']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = action;
        button.dataset.id = item.id;
        button.textContent = label;
        button.setAttribute('aria-label', label + ' ' + item.name);
        actions.append(button);
      }
      card.append(preview, title, actions);
      if (item.id === openProject) {
        const current = document.createElement('small');
        current.textContent = 'Open in maker';
        card.insertBefore(current, actions);
      }
      grid.append(card);
    }
  }

  function controls() {
    const projectUpdate = projects.querySelector('[data-action=update]');
    projectUpdate.hidden = !openProject;
    for (const button of panel.querySelectorAll('button')) {
      button.disabled = busy || (presets.contains(button) && button.dataset.action !== 'save' && !select.value);
    }
    for (const input of panel.querySelectorAll('input,select')) input.disabled = busy;
  }

  async function list(preset = select.value) {
    ({items: entries} = await request());
    select.replaceChildren(new Option('Choose a preset', ''), ...entries.filter(item => item.kind === 'preset')
      .map(item => new Option(item.name, item.id)));
    if (entries.some(item => item.id === preset && item.kind === 'preset')) select.value = preset;
    if (!entries.some(item => item.id === openProject)) openProject = undefined;
    renderProjects();
    controls();
  }

  select.onchange = () => {
    presetName.value = entries.find(item => item.id === select.value)?.name || '';
    controls();
  };
  search.oninput = () => {renderProjects(); controls();};

  panel.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button || busy) return;
    const project = projects.contains(button);
    const kind = project ? 'project' : 'preset';
    const label = project ? 'Project' : 'Preset';
    const area = project ? projects : presets;
    const status = area.querySelector('[role=status]');
    const name = project ? projectName : presetName;
    const {action} = button.dataset;
    const id = project ? button.dataset.id || openProject : select.value;
    const selected = entries.find(item => item.id === id && item.kind === kind);
    if (action !== 'save' && !selected) return;
    if (action === 'delete' && !window.confirm('Delete “' + selected.name + '”?')) return;
    busy = true;
    controls();
    status.textContent = 'Working…';
    try {
      if (action === 'open') {
        const {payload} = await request('/' + id);
        const restored = await Promise.all((payload.files || []).map(async file => {
          const blob = await (await fetch(file.data)).blob();
          return new File([blob], file.name, {type: blob.type});
        }));
        await apply(payload.settings, restored);
        if (project) {
          openProject = id;
          name.value = selected.name;
          renderProjects();
        }
        status.textContent = project ? 'Project opened.' : 'Preset applied.';
      } else if (action === 'delete') {
        await request('/' + id, {});
        if (!project || openProject === id) name.value = '';
        await list(!project ? '' : select.value);
        status.textContent = label + ' deleted.';
      } else {
        if (!name.value.trim()) throw Error('Enter a ' + kind + ' name first.');
        const payload = {version: 1, settings: settings(kind)};
        let thumbnail;
        if (project) {
          const artwork = files();
          if (!artwork.length) throw Error('Add artwork before saving a project.');
          if (artwork.reduce((size, file) => size + file.size, 0) > 19000000) throw Error('Project artwork must total 19 MB or less.');
          [payload.files, thumbnail] = await Promise.all([Promise.all(artwork.map(savedArtwork)), projectThumbnail(artwork[0])]);
        }
        const saved = await request('', {kind, name: name.value, payload, thumbnail, replace: action === 'update' ? id : undefined});
        if (project) {
          openProject = saved.id;
          search.value = '';
        }
        await list(project ? select.value : saved.id);
        status.textContent = label + ' saved.';
      }
    } catch (error) { status.textContent = error.message; }
    finally {
      busy = false;
      controls();
      if (!button.isConnected) {
        const restoredButton = [...grid.querySelectorAll('button')].find(node => node.dataset.id === id && node.dataset.action === action);
        (restoredButton || search).focus({preventScroll: true});
      }
    }
  });
  try {await list();} catch (error) {
    for (const status of panel.querySelectorAll('[role=status]')) status.textContent = error.message;
  }
};
