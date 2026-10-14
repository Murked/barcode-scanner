// Parts and slots are the customization surface — treat their names as public API.
export const template = /* html */ `
<div part="root">
  <div part="viewfinder">
    <video part="video" muted playsinline autoplay></video>
    <div part="overlay" data-overlay hidden><slot name="overlay"><div part="reticle"></div></slot></div>
    <div part="idle" data-idle><slot name="idle"></slot></div>
  </div>

  <div part="controls">
    <slot name="controls">
      <button part="button start-button" data-start type="button"></button>
      <button part="button stop-button" data-stop type="button" hidden></button>
      <button part="button torch-button" data-torch type="button" aria-pressed="false" hidden></button>
    </slot>
  </div>

  <p part="status" role="status" aria-live="polite"><span data-status-text></span><slot name="status"></slot></p>

  <form part="manual" data-manual hidden>
    <input part="manual-input" data-manual-input inputmode="numeric" autocomplete="off" enterkeyhint="search">
    <button part="button manual-button" data-manual-button type="submit"></button>
  </form>

  <div part="result" data-result hidden>
    <slot name="result">
      <img part="product-image" data-product-image alt="" hidden>
      <div part="product-text">
        <strong part="product-name" data-product-name></strong>
        <span part="product-meta" data-product-meta></span>
      </div>
      <a part="product-link" data-product-link hidden></a>
      <button part="button again-button" data-again type="button"></button>
    </slot>
  </div>
</div>`;
