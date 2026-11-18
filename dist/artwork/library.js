const $ = id => document.getElementById(id);
const desktop = matchMedia('(hover: hover) and (pointer: fine)');
const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canEdit = () => desktop.matches && !mobile;
let artwork = [];
let selected;
let editor;
let pending = false;

function showResults() {
  const terms = $('search').value.toLowerCase().trim().split(/\s+/);
  const category = $('category').value;
  const matches = artwork.filter(item => {
    const searchable = [item.title, item.category, ...item.tags].join(' ').toLowerCase();
    return (!category || item.category === category) && terms.every(term => searchable.includes(term));
  });
  $('results').textContent = matches.length ? `${matches.length} design${matches.length === 1 ? '' : 's'}` :
    artwork.length ? 'No designs match your search.' : 'No artwork is available yet.';
  $('gallery').replaceChildren(...matches.map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    const image = document.createElement('img');
    image.src = item.url;
    image.alt = '';
    image.loading = 'lazy';
    const label = document.createElement('span');
    label.textContent = item.title;
    button.append(image, label);
    button.onclick = () => void choose(item, button);
    return button;
  }));
}

async function transfer(blob, item) {
  if (!window.opener || window.opener.closed) throw Error('Open the artwork library from the maker to use a design.');
  const extension = blob.type === 'image/jpeg' ? '.jpg' : '.png';
  const name = item.title.replace(/[\\/:]/g, '-') + extension;
  const error = await window.opener.coasterPrintImportArtwork(window, new File([blob], name, {type: blob.type}));
  if (error) throw Error(error);
  window.opener.focus();
  window.close();
}

async function choose(item, button) {
  if (pending) return;
  pending = true;
  button.disabled = true;
  $('feedback').textContent = 'Loading artwork…';
  try {
    const response = await fetch(item.url);
    if (!response.ok) throw Error('This design is unavailable. Choose another design or try again later.');
    const blob = await response.blob();
    if (!canEdit()) {
      await transfer(blob, item);
      return;
    }
    const {createEditor} = await import('./editor.js');
    if (!canEdit()) {
      await transfer(blob, item);
      return;
    }
    editor = await createEditor(blob);
    if (!canEdit()) {
      editor = null;
      await transfer(blob, item);
      return;
    }
    selected = {item, button};
    $('editor-title').textContent = item.title;
    $('library').hidden = true;
    $('editor').hidden = false;
    $('editor-title').focus();
    $('editor').append($('feedback'));
    $('feedback').textContent = '';
  } catch (error) {
    $('feedback').textContent = error.message;
  } finally {
    pending = false;
    button.disabled = false;
  }
}

function back() {
  $('editor').hidden = true;
  $('library').hidden = false;
  $('gallery').before($('feedback'));
  $('feedback').textContent = '';
  selected?.button.focus();
  selected = null;
  editor = null;
}

$('back').onclick = back;
desktop.addEventListener('change', () => { if (editor && !canEdit()) back(); });
$('build').onclick = async () => {
  if (!editor || pending || !canEdit()) return;
  const active = editor;
  const {item} = selected;
  pending = true;
  $('build').disabled = true;
  $('feedback').textContent = 'Sending artwork to the maker…';
  try {
    const blob = await active.export();
    if (editor !== active || !canEdit()) return;
    await transfer(blob, item);
  } catch (error) {
    $('feedback').textContent = error.message;
  } finally {
    pending = false;
    $('build').disabled = false;
  }
};
$('search').addEventListener('input', showResults);
$('category').addEventListener('change', showResults);
$('results').textContent = 'Loading artwork…';
try {
  const response = await fetch('/api/artwork');
  if (!response.ok) throw Error();
  ({artwork} = await response.json());
  const categories = [...new Set(artwork.map(item => item.category))].sort((a, b) => a.localeCompare(b));
  for (const category of categories) $('category').add(new Option(category, category));
  showResults();
} catch {
  $('results').textContent = 'The artwork library could not load. Refresh to try again.';
}
