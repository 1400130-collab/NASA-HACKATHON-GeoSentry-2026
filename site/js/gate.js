// Big screens only. Below 900 px wide (phones, small windows) every page is hidden behind one screen that says
// to open GeoSentry on a computer. Loaded first in <head> so the page never flashes. Printing is not affected.
(() => {
  const MIN = 900;
  const css = `
@media screen and (max-width: ${MIN - 1}px) {
  html, body { overflow: hidden !important; height: 100% !important; }
  body > *:not(#gs-gate) { display: none !important; }
  #gs-gate { display: flex !important; }
}
#gs-gate { display: none; position: fixed; inset: 0; z-index: 2147483647; flex-direction: column; justify-content: center;
  gap: 28px; padding: 32px 28px; background: #0b0c0d; color: #f3f1ec; overflow: hidden;
  font-family: "Roboto", "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  -webkit-font-smoothing: antialiased; }
#gs-gate::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .5;
  background: radial-gradient(120% 60% at 100% 0%, rgba(255, 77, 46, .28), transparent 60%),
              repeating-radial-gradient(circle at 85% 15%, transparent 0 22px, rgba(255, 255, 255, .05) 22px 23px); }
#gs-gate > * { position: relative; }
#gs-gate .gs-mark { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; line-height: 1; letter-spacing: -.01em; }
#gs-gate .gs-mark img { width: 52px; height: 36px; }
#gs-gate h1 { margin: 0; font-size: clamp(40px, 12vw, 72px); line-height: .95; font-weight: 800; letter-spacing: -.045em; }
#gs-gate h1 em { font-style: normal; color: #ff4d2e; }
#gs-gate .gs-ko { margin: -12px 0 0; font-size: 20px; font-weight: 700; letter-spacing: -.02em; color: rgba(243, 241, 236, .7); }
#gs-gate .gs-copy { align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; border: 0; border-radius: 6px;
  padding: 15px 22px; background: #ff4d2e; color: #0b0c0d; font-size: 16px; font-weight: 700; line-height: 1; font-family: inherit; cursor: pointer; }
#gs-gate .gs-url { font: 500 13px/1.4 "Roboto Mono", ui-monospace, Menlo, monospace; color: rgba(243, 241, 236, .45); word-break: break-all; }
@media print { #gs-gate { display: none !important; } }`;
  const style = document.createElement('style');
  style.id = 'gs-gate-style';
  style.textContent = css;
  document.head.appendChild(style);

  const build = () => {
    if (document.getElementById('gs-gate')) return;
    const url = location.origin + location.pathname;
    const gate = document.createElement('div');
    gate.id = 'gs-gate';
    gate.setAttribute('role', 'alert');
    gate.innerHTML = `
      <div class="gs-mark"><img src="img/geosentry-logo.svg?v=2" alt=""><span>GeoSentry</span></div>
      <h1>Open this on a <em>computer.</em></h1>
      <p class="gs-ko">컴퓨터에서 열어 주세요.</p>
      <button class="gs-copy" type="button">Copy link <span aria-hidden="true">→</span></button>
      <div class="gs-url"></div>`;
    gate.querySelector('.gs-url').textContent = url;
    const btn = gate.querySelector('.gs-copy');
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); btn.firstChild.textContent = 'Copied '; }
      catch { if (navigator.share) navigator.share({ url }).catch(() => {}); }
    });
    document.body.appendChild(gate);
  };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
