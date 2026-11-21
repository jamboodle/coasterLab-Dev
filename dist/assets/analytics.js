(() => {
  if (location.protocol !== 'https:' || location.hostname !== 'coasterprint.com') return;

  const measurementId = 'G-F58HSJ6SHB';
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  // Keep account parameters and maker handoff details out of page reporting.
  const pageLocation = location.origin + location.pathname;
  const referrer = document.referrer ? new URL(document.referrer) : null;
  gtag('js', new Date());
  gtag('config', measurementId, {
    page_location: pageLocation,
    page_referrer: referrer ? referrer.origin + referrer.pathname : ''
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.append(script);
})();
