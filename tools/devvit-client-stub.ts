/** Browser stub so the game runs outside Reddit's iframe. */
export function requestExpandedMode(_e: Event, view: string): void {
  window.location.href = `/${view}.html`;
}

export function showToast(message: string): void {
  let el = document.getElementById('local-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'local-toast';
    el.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:rgba(0,0,0,0.85);color:#ffe98a;padding:10px 16px;border-radius:12px;' +
      'font:700 14px Trebuchet MS,sans-serif;pointer-events:none;transition:opacity 0.3s';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  window.setTimeout(() => {
    if (el) el.style.opacity = '0';
  }, 2200);
}
