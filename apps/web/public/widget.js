/* Helio on-site widgets embed. Loaded with:
   <script async src="https://<app>/widget.js" data-write-key="wk_…"></script>
   Fetches the workspace's active widgets and renders them. No dependencies. */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-write-key');
  if (!key) return;
  var base = new URL(script.src).origin;

  fetch(base + '/api/widgets?key=' + encodeURIComponent(key))
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      (data.widgets || []).forEach(render);
    })
    .catch(function () {});

  // A legible #hex (near-black or white) to place on a colored button —
  // mirrors @helio/core readableTextColor (WCAG relative luminance, 0.45 cut).
  function readable(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return '#0a0a0a';
    function lin(c) {
      c = parseInt(c, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    var L = 0.2126 * lin(h.slice(0, 2)) + 0.7152 * lin(h.slice(2, 4)) + 0.0722 * lin(h.slice(4, 6));
    return L > 0.45 ? '#0a0a0a' : '#ffffff';
  }

  // Server-re-validated; fall back to neutrals if an older payload omits it.
  var DEFAULT_PALETTE = { background: '#fff', text: '#111', button: '#111', accent: '#e5e5e5' };

  function baseStyles(isPopup, p) {
    var common =
      'position:fixed;z-index:2147483000;background:' +
      p.background +
      ';color:' +
      p.text +
      ';border:1px solid ' +
      p.accent +
      ';box-shadow:0 6px 24px rgba(0,0,0,.12);padding:16px 36px 16px 16px;' +
      'font-family:system-ui,-apple-system,sans-serif;font-size:14px;';
    return isPopup
      ? common + 'bottom:20px;right:20px;max-width:320px;border-radius:12px;'
      : common + 'left:0;right:0;bottom:0;text-align:center;';
  }

  function render(widget) {
    var palette = widget.palette || DEFAULT_PALETTE;
    var el = document.createElement('div');
    el.setAttribute('data-helio-widget', widget.id);
    el.style.cssText = baseStyles(widget.type === 'POPUP', palette);

    var title = document.createElement('strong');
    title.textContent = widget.title;
    title.style.display = 'block';
    el.appendChild(title);

    var body = document.createElement('span');
    body.textContent = widget.body;
    el.appendChild(body);

    if (widget.ctaUrl && widget.ctaLabel) {
      var cta = document.createElement('a');
      cta.href = widget.ctaUrl;
      cta.textContent = widget.ctaLabel;
      cta.style.cssText =
        'display:inline-block;margin-top:8px;color:' +
        readable(palette.button) +
        ';background:' +
        palette.button +
        ';padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px;';
      el.appendChild(cta);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss');
    close.style.cssText =
      'position:absolute;top:6px;right:8px;border:0;background:transparent;' +
      'font-size:18px;cursor:pointer;line-height:1;color:inherit;';
    close.onclick = function () {
      el.remove();
    };
    el.appendChild(close);

    document.body.appendChild(el);
  }
})();
