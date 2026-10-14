// Every visual decision goes through a custom property so integrators can theme in one line.
export const styles = /* css */ `
:host {
  --bs-accent: #2563eb;
  --bs-accent-text: #fff;
  --bs-bg: #fff;
  --bs-text: #111827;
  --bs-muted: #6b7280;
  --bs-error: #b91c1c;
  --bs-border: #e5e7eb;
  --bs-radius: 12px;
  --bs-gap: .75rem;
  --bs-font: inherit;
  --bs-aspect: 4 / 3;
  --bs-viewfinder-bg: #000;
  --bs-reticle: rgb(255 255 255 / .85);
  display: block;
  font-family: var(--bs-font);
  color: var(--bs-text);
}
:host([hidden]) { display: none; }
[hidden] { display: none !important; }
[part="root"] { display: grid; gap: var(--bs-gap); }
[part="viewfinder"] {
  position: relative; aspect-ratio: var(--bs-aspect); border-radius: var(--bs-radius);
  overflow: hidden; background: var(--bs-viewfinder-bg);
}
[part="video"] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
[part="overlay"], [part="idle"] { position: absolute; inset: 0; pointer-events: none; }
[part="idle"] { display: grid; place-items: center; color: #fff; text-align: center; padding: 1rem; }
[part="reticle"] {
  position: absolute; inset: 30% 12%; border: 2px solid var(--bs-reticle); border-radius: 8px;
  box-shadow: 0 0 0 100vmax rgb(0 0 0 / .25);
}
[part="controls"] { display: flex; flex-wrap: wrap; gap: .5rem; }
[part~="button"] {
  background: var(--bs-accent); color: var(--bs-accent-text); border: 0;
  border-radius: calc(var(--bs-radius) / 1.5); padding: .6em 1.1em; font: inherit; cursor: pointer;
}
[part~="button"]:focus-visible, [part="manual-input"]:focus-visible, [part="product-link"]:focus-visible {
  outline: 2px solid var(--bs-accent); outline-offset: 2px;
}
[part~="stop-button"], [part~="torch-button"] { background: transparent; color: var(--bs-text); box-shadow: inset 0 0 0 1px var(--bs-border); }
[part~="torch-button"][aria-pressed="true"] { background: var(--bs-accent); color: var(--bs-accent-text); box-shadow: none; }
[part~="status"] { color: var(--bs-muted); min-height: 1.5em; margin: 0; }
[part~="status-error"] { color: var(--bs-error); }
[part="manual"] { display: flex; gap: .5rem; }
[part="manual-input"] {
  flex: 1; min-width: 0; font: inherit; color: inherit; background: var(--bs-bg);
  border: 1px solid var(--bs-border); border-radius: calc(var(--bs-radius) / 1.5); padding: .55em .8em;
}
[part="result"] {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--bs-gap);
  padding: var(--bs-gap); background: var(--bs-bg); border: 1px solid var(--bs-border); border-radius: var(--bs-radius);
}
[part="product-image"] { width: 64px; height: 64px; object-fit: contain; border-radius: calc(var(--bs-radius) / 2); }
[part="product-text"] { display: grid; gap: .15rem; min-width: 0; flex: 1 1 12rem; }
[part="product-meta"] { color: var(--bs-muted); font-size: .875em; }
[part="product-link"] { color: var(--bs-accent); }
`;
