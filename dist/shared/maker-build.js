'use strict';

window.startMakerBuild = function startMakerBuild(stage, anchor) {
  const controller = new AbortController();
  const panel = document.createElement('div');
  panel.className = 'build-feedback';
  panel.innerHTML = '<p role="status" aria-live="polite"></p><progress aria-label="Build in progress"></progress>' +
    '<div class="build-feedback-actions"><span></span><button type="button">Cancel build</button></div><small hidden>Still working. Detailed artwork can take longer on phones.</small>';
  const message = panel.querySelector('p');
  const elapsed = panel.querySelector('span');
  const cancel = panel.querySelector('button');
  const hint = panel.querySelector('small');
  const started = performance.now();
  function tick() {
    const seconds = Math.floor((performance.now() - started) / 1000);
    elapsed.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' elapsed';
    hint.hidden = seconds < 8;
  }
  message.textContent = stage;
  tick();
  const timer = setInterval(tick, 1000);
  anchor.before(panel);
  document.body.classList.add('maker-building');
  cancel.onclick = () => {
    cancel.disabled = true;
    message.textContent = 'Cancelling…';
    controller.abort(new DOMException('Build cancelled. Your artwork is still loaded.', 'AbortError'));
  };
  return {
    signal: controller.signal,
    cancel() { controller.abort(); },
    update(text) { if (!controller.signal.aborted) message.textContent = text; },
    finish() {
      clearInterval(timer);
      const focused = document.activeElement === cancel;
      panel.remove();
      document.body.classList.remove('maker-building');
      return focused;
    }
  };
};

window.runMakerWorker = function runMakerWorker(url, options, data, {
  signal, transfer = [], timeout = 120000, timeoutMessage = 'Processing took too long. Try smoother detail or a smaller image.',
  engineError = 'The processing engine could not start.', acceptError = false, onProgress = () => {}
} = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(url, options);
    const timer = setTimeout(() => finish(reject, Error(timeoutMessage)), timeout);
    const onAbort = () => finish(reject, signal.reason);
    function finish(callback, value) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      callback(value);
    }
    signal?.addEventListener('abort', onAbort, {once: true});
    worker.onmessage = ({data: output}) => {
      if (typeof output.progress === 'string') onProgress(output.progress);
      else if (output.error && !acceptError) finish(reject, Error(output.error));
      else finish(resolve, output);
    };
    worker.onerror = () => finish(reject, Error(engineError));
    worker.onmessageerror = () => finish(reject, Error('The browser could not read the processing result.'));
    try { worker.postMessage(data, transfer); } catch (error) { finish(reject, error); }
  });
};
