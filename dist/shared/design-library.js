export const makerNames = {
  plaque: 'Plaque Maker',
  'cookie-cutter': 'Cookie Cutter Maker'
};

export function connectDesignLibrary(maker, importImage) {
  let library;
  for (const link of document.querySelectorAll('a[href="/resources/"]')) {
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const page = window.open('/resources/?maker=' + maker, '_blank');
      if (!page) return;
      event.preventDefault();
      library = page;
    });
  }

  window.coasterPrintImportDesign = async (source, file) => {
    if (!library || source !== library || source.closed || source.location.origin !== location.origin ||
        source.location.pathname !== '/resources/') return 'Open Design Library from this maker to send a design.';
    return importImage(file);
  };
}

export function designLibraryDestination() {
  const maker = new URLSearchParams(location.search).get('maker');
  if (!Object.hasOwn(makerNames, maker) || !window.opener) return null;
  try {
    if (window.opener.location.origin === location.origin &&
        window.opener.location.pathname === '/' + maker + '/' &&
        typeof window.opener.coasterPrintImportDesign === 'function') return makerNames[maker];
  } catch { /* A page from another origin cannot receive artwork. */ }
  return null;
}
