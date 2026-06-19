import { buildBootstrapUrl } from './bootstrap-url.js';
import type { NormalizedIframeBridgeConfig } from './config.js';

export function configureIframe(
  iframe: HTMLIFrameElement,
  config: NormalizedIframeBridgeConfig,
): void {
  if (config.sandbox !== undefined) {
    iframe.setAttribute('sandbox', config.sandbox);
  }

  applyIframeAttributes(iframe, config);
  iframe.src = buildBootstrapUrl(config.url, config.bootstrap).href;
}

function applyIframeAttributes(
  iframe: HTMLIFrameElement,
  config: NormalizedIframeBridgeConfig,
): void {
  const attributes = config.iframeAttributes;

  if (attributes.allow !== undefined) {
    iframe.allow = attributes.allow;
  }

  if (attributes.allowFullscreen !== undefined) {
    iframe.allowFullscreen = attributes.allowFullscreen;
  }

  if (attributes.className !== undefined) {
    iframe.className = attributes.className;
  }

  if (attributes.id !== undefined) {
    iframe.id = attributes.id;
  }

  if (attributes.loading !== undefined) {
    iframe.loading = attributes.loading;
  }

  if (attributes.name !== undefined) {
    iframe.name = attributes.name;
  }

  if (attributes.referrerPolicy !== undefined) {
    iframe.referrerPolicy = attributes.referrerPolicy;
  }

  if (attributes.title !== undefined) {
    iframe.title = attributes.title;
  }
}
