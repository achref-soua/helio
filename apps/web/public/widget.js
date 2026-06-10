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

  function baseStyles(isPopup) {
    var common =
      'position:fixed;z-index:2147483000;background:#fff;color:#111;border:1px solid #e5e5e5;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.12);padding:16px 36px 16px 16px;' +
      'font-family:system-ui,-apple-system,sans-serif;font-size:14px;';
    return isPopup
      ? common + 'bottom:20px;right:20px;max-width:320px;border-radius:12px;'
      : common + 'left:0;right:0;bottom:0;text-align:center;';
  }

  function render(widget) {
    var el = document.createElement('div');
    el.setAttribute('data-helio-widget', widget.id);
    el.style.cssText = baseStyles(widget.type === 'POPUP');

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
        'display:inline-block;margin-top:8px;color:#fff;background:#111;' +
        'padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px;';
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
