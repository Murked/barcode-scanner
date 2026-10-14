import { BarcodeScannerElement } from './barcode-scanner';

if (typeof customElements !== 'undefined' && !customElements.get('barcode-scanner')) {
  customElements.define('barcode-scanner', BarcodeScannerElement);
}

export { BarcodeScannerElement };
export { defaultMessages, mergeMessages } from './messages';
export type { Messages, MessagesInput } from './messages';

declare global {
  interface HTMLElementTagNameMap {
    'barcode-scanner': BarcodeScannerElement;
  }
}
