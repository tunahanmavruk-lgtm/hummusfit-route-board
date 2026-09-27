(function () {
  const links = document.querySelectorAll('[data-essentials-nav]');
  if (!links.length) return;
  fetch('/essentials', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
    .then(function (response) {
      if (!response.ok) return;
      links.forEach(function (link) { link.hidden = false; });
    })
    .catch(function () {
      // Keep the link hidden if the feature route is disabled or unavailable.
    });
})();
