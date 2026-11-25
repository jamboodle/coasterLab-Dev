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

window.mountProLibrary = async function mountProLibrary({maker, anchor, settings, files, apply}) {
  if (!await window.coasterProActive()) return;
  const panel = document.createElement('details');
  panel.className = 'pro-library';
  panel.innerHTML = '<summary>Pro projects and presets</summary><p>Projects save your artwork and settings to your account. Presets apply settings to your current artwork.</p>' +
    '<label>Saved item <select><option value="">Choose a project or preset</option></select></label>' +
    '<label>Name <input type="text" maxlength="80"></label><div class="pro-library-actions">' +
    '<button type="button" data-action="open">Open / apply</button><button type="button" data-action="project">Save new project</button>' +
    '<button type="button" data-action="preset">Save new preset</button><button type="button" data-action="update">Update selected</button>' +
    '<button type="button" data-action="delete">Delete selected</button></div><p role="status" aria-live="polite"></p>';
  anchor.after(panel);
  const select = panel.querySelector('select');
  const name = panel.querySelector('input');
  const status = panel.querySelector('[role=status]');
  const endpoint = '/api/pro/library/' + maker;
  let entries = [];
  async function request(suffix = '', payload) {
    const response = await fetch(endpoint + suffix, {signal: AbortSignal.timeout(60000), ...(payload && {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    })});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Could not access your Pro library.');
    return data;
  }
  async function list(id) {
    ({items: entries} = await request());
    select.replaceChildren(new Option('Choose a project or preset', ''), ...entries.map(item =>
      new Option((item.kind === 'project' ? 'Project · ' : 'Preset · ') + item.name, item.id)));
    if (id) select.value = id;
  }
  select.onchange = () => { name.value = entries.find(item => item.id === select.value)?.name || ''; };
  panel.addEventListener('click', async event => {
    const action = event.target.dataset.action;
    if (!action || panel.getAttribute('aria-busy') === 'true') return;
    const selected = entries.find(item => item.id === select.value);
    if (['open', 'delete', 'update'].includes(action) && !selected) {
      status.textContent = 'Choose a saved project or preset first.';
      return;
    }
    if (action === 'delete' && !window.confirm('Delete “' + selected.name + '”?')) return;
    panel.setAttribute('aria-busy', 'true');
    for (const button of panel.querySelectorAll('button')) button.disabled = true;
    status.textContent = 'Working…';
    try {
      if (action === 'open') {
        const {payload} = await request('/' + selected.id);
        const restored = await Promise.all((payload.files || []).map(async file => {
          const blob = await (await fetch(file.data)).blob();
          return new File([blob], file.name, {type: blob.type});
        }));
        await apply(payload.settings, restored);
        status.textContent = selected.kind === 'project' ? 'Project opened.' : 'Preset applied.';
      } else if (action === 'delete') {
        await request('/' + selected.id, {});
        await list();
        name.value = '';
        status.textContent = 'Saved item deleted.';
      } else {
        if (!name.value.trim()) throw Error('Enter a name first.');
        const kind = action === 'update' ? selected.kind : action;
        const payload = {version: 1, settings: settings(kind)};
        if (kind === 'project') {
          const artwork = files();
          if (!artwork.length) throw Error('Add artwork before saving a project.');
          if (artwork.reduce((size, file) => size + file.size, 0) > 19000000) throw Error('Project artwork must total 19 MB or less.');
          payload.files = await Promise.all(artwork.map(file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(Error('Could not read the artwork.'));
            reader.onload = () => {
              const mime = /\.png$/i.test(file.name) ? 'png' : 'jpeg';
              resolve({name: file.name, data: String(reader.result).replace(/^data:[^;,]*/, 'data:image/' + mime)});
            };
            reader.readAsDataURL(file);
          })));
        }
        const saved = await request('', {kind, name: name.value, payload, replace: action === 'update' ? selected.id : undefined});
        await list(saved.id);
        status.textContent = kind === 'project' ? 'Project saved.' : 'Preset saved.';
      }
    } catch (error) { status.textContent = error.message; }
    finally {
      panel.removeAttribute('aria-busy');
      for (const button of panel.querySelectorAll('button')) button.disabled = false;
    }
  });
  try {await list();} catch (error) {status.textContent = error.message;}
};
