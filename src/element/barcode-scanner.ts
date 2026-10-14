import { createScanner } from '../scanner';
import { urlLookup } from '../lookup';
import type { BarcodeFormat, LookupFn, Product, Scanner, ScannerState } from '../types';
import type { ScannerError } from '../errors';
import { template } from './template';
import { styles } from './styles';
import { defaultMessages, mergeMessages, type Messages, type MessagesInput } from './messages';

const LIVE = new Set<ScannerState>(['starting', 'scanning', 'looking-up']);

// Keeps the module importable during SSR; the element is only defined in browsers.
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

/**
 * `<barcode-scanner>` — default UI over the headless core.
 *
 * Attributes: `formats`, `lookup-url`, `mode`, `manual-entry`, `autostart`, `wasm-url`.
 * Properties: `lookup`, `messages`, `scanner` (read-only escape hatch).
 * Events (bubbling, composed): `barcode-state`, `barcode-detect`, `barcode-product`,
 * `barcode-not-found`, `barcode-error`.
 */
export class BarcodeScannerElement extends Base {
  static observedAttributes = ['formats', 'lookup-url', 'mode', 'manual-entry', 'wasm-url'];

  #scanner?: Scanner<Product>;
  #offs: (() => void)[] = [];
  #lookup?: LookupFn<any>;
  #messagesInput: MessagesInput = {};
  #messages: Messages = defaultMessages;
  #status: { text: () => string; error: boolean } = { text: () => '', error: false };
  #state: ScannerState = 'idle';
  #cameraOn = false;
  #torchOn = false;
  #rendered = false;
  #root: ShadowRoot;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  #$<T extends Element = HTMLElement>(sel: string): T {
    return this.#root.querySelector<T>(sel)!;
  }

  /** Custom lookup function. Takes precedence over `lookup-url`. */
  get lookup(): LookupFn<any> | undefined {
    return this.#lookup;
  }
  set lookup(fn: LookupFn<any> | undefined) {
    this.#lookup = fn;
    if (this.#rendered) this.#rebuild();
  }

  /** Partial wording overrides (i18n). `state` and `errors` merge key by key. */
  get messages(): Messages {
    return this.#messages;
  }
  set messages(m: MessagesInput) {
    this.#messagesInput = m ?? {};
    this.#messages = mergeMessages(this.#messagesInput);
    this.#renderText();
  }

  /** The underlying core scanner (escape hatch). Replaced when attributes change. */
  get scanner(): Scanner<Product> | undefined {
    return this.#scanner;
  }

  start(): Promise<void> {
    return this.#scanner?.start() ?? Promise.resolve();
  }

  stop(): void {
    this.#scanner?.stop();
  }

  connectedCallback() {
    this.#upgradeProperty('lookup');
    this.#upgradeProperty('messages');
    if (!this.#rendered) this.#render();
    this.#rebuild();
    if (this.hasAttribute('autostart')) void this.start();
  }

  disconnectedCallback() {
    this.#teardown();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue || !this.#scanner) return;
    if (name === 'manual-entry') this.#$('[data-manual]').hidden = newValue === null;
    else this.#rebuild();
  }

  /** Properties set before the element was defined shadow the accessors; re-apply them. */
  #upgradeProperty(prop: 'lookup' | 'messages') {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const value = (this as any)[prop];
      delete (this as any)[prop];
      (this as any)[prop] = value;
    }
  }

  #render() {
    this.#root.innerHTML = `<style>${styles}</style>${template}`;
    this.#rendered = true;
    this.#renderText();

    this.#$('[data-start]').addEventListener('click', () => void this.start());
    this.#$('[data-stop]').addEventListener('click', () => this.stop());
    this.#$('[data-torch]').addEventListener('click', () => void this.#toggleTorch());
    this.#$('[data-again]').addEventListener('click', () => {
      this.#showResult(null);
      void this.start();
    });
    this.#$<HTMLImageElement>('[data-product-image]').addEventListener('error', (e) => {
      (e.currentTarget as HTMLImageElement).hidden = true;
    });
    this.#$<HTMLFormElement>('[data-manual]').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.#scanner?.lookup(this.#$<HTMLInputElement>('[data-manual-input]').value);
    });
  }

  #teardown() {
    this.#offs.forEach((off) => off());
    this.#offs = [];
    this.#scanner?.destroy();
    this.#scanner = undefined;
  }

  #rebuild() {
    const wasLive = this.#scanner ? LIVE.has(this.#scanner.state) && this.#scanner.state !== 'looking-up' : false;
    this.#teardown();

    const lookupUrl = this.getAttribute('lookup-url');
    const formats = this.getAttribute('formats')
      ?.split(',')
      .map((f) => f.trim())
      .filter(Boolean) as BarcodeFormat[] | undefined;
    const mode = this.getAttribute('mode') === 'single' ? 'single' : 'continuous';
    this.#$('[data-manual]').hidden = !this.hasAttribute('manual-entry');

    const s = (this.#scanner = createScanner<Product>({
      video: this.#$<HTMLVideoElement>('video'),
      formats: formats?.length ? formats : undefined,
      mode,
      wasmUrl: this.getAttribute('wasm-url') ?? undefined,
      lookup: this.#lookup ?? (lookupUrl ? urlLookup(lookupUrl) : undefined),
    }));

    this.#offs = [
      s.on('state', (state) => this.#onState(state)),
      s.on('detect', (code) => {
        this.#showResult(null);
        this.#emit('barcode-detect', code);
      }),
      s.on('not-found', (d) => {
        this.#setStatus(() => this.#messages.notFound(d.code.value));
        this.#emit('barcode-not-found', d);
      }),
      s.on('product', (d) => {
        this.#showResult(d.product);
        this.#emit('barcode-product', d);
      }),
      s.on('error', (err: ScannerError) => {
        this.#setStatus(() => this.#messages.errors[err.code] ?? err.code, true);
        if (err.code === 'invalid-input') this.#$<HTMLInputElement>('[data-manual-input]').focus();
        this.#emit('barcode-error', { code: err.code, error: err });
      }),
    ];

    this.#applyState(s.state);
    if (wasLive) void s.start();
  }

  #onState(state: ScannerState) {
    this.#applyState(state);
    this.#emit('barcode-state', { state });
  }

  #applyState(state: ScannerState) {
    const prev = this.#state;
    this.#state = state;
    const live = LIVE.has(state);
    // The camera stays on during a camera lookup, but not during a manual one.
    if (state === 'scanning') this.#cameraOn = true;
    else if (state !== 'looking-up') this.#cameraOn = false;

    this.#$('[data-start]').hidden = live;
    this.#$('[data-stop]').hidden = !live;
    this.#$('[data-idle]').hidden = live;
    this.#$('[data-overlay]').hidden = !this.#cameraOn;
    this.setAttribute('state', state);

    if (state === 'starting') this.#showResult(null);
    if (state === 'scanning' && prev === 'starting') {
      // Probe torch support on a fresh camera (turning it "off" is harmless).
      this.#torchOn = false;
      void this.#scanner?.setTorch(false).then((ok) => this.#updateTorch(ok && this.#cameraOn));
    } else if (!this.#cameraOn) {
      this.#torchOn = false;
      this.#updateTorch(false);
    }
    // Errors set their own text right after the state change; keep it.
    if (state !== 'error') this.#setStatus(() => this.#messages.state[state]);
  }

  async #toggleTorch() {
    const next = !this.#torchOn;
    const ok = (await this.#scanner?.setTorch(next)) ?? false;
    if (ok) this.#torchOn = next;
    this.#updateTorch(ok);
  }

  #updateTorch(visible: boolean) {
    const btn = this.#$('[data-torch]');
    btn.hidden = !visible;
    btn.setAttribute('aria-pressed', String(this.#torchOn));
  }

  #showResult(p: Product | null) {
    const box = this.#$('[data-result]');
    box.hidden = !p;
    if (!p) return;
    // Fills only the DEFAULT result markup; slotted custom results use the event instead.
    const img = this.#$<HTMLImageElement>('[data-product-image]');
    img.hidden = !p.imageUrl;
    if (p.imageUrl) img.src = p.imageUrl;
    else img.removeAttribute('src');
    img.alt = p.name ?? '';
    this.#$('[data-product-name]').textContent = p.name ?? '';
    this.#$('[data-product-meta]').textContent = [p.brand, p.styleCode].filter(Boolean).join(' · ');
    const link = this.#$<HTMLAnchorElement>('[data-product-link]');
    link.hidden = !p.pageUrl;
    if (p.pageUrl) link.href = p.pageUrl;
    else link.removeAttribute('href');
  }

  #setStatus(text: () => string, error = false) {
    this.#status = { text, error };
    this.#renderStatus();
  }

  #renderStatus() {
    if (!this.#rendered) return;
    this.#$('[data-status-text]').textContent = this.#status.text();
    this.#$('[part~="status"]').setAttribute('part', this.#status.error ? 'status status-error' : 'status');
  }

  #renderText() {
    if (!this.#rendered) return;
    const m = this.#messages;
    this.#$('[data-start]').textContent = m.start;
    this.#$('[data-stop]').textContent = m.stop;
    this.#$('[data-torch]').textContent = m.torch;
    this.#$('[data-manual-button]').textContent = m.manualButton;
    const input = this.#$<HTMLInputElement>('[data-manual-input]');
    input.placeholder = m.manualPlaceholder;
    input.setAttribute('aria-label', m.manualLabel);
    this.#$('[data-again]').textContent = m.again;
    this.#$('[data-product-link]').textContent = m.viewProduct;
    this.#renderStatus();
  }

  #emit(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}
