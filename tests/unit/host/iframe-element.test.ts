import { describe, expect, test } from 'vitest';

import { configureIframe } from '../../../src/host/iframe-element';
import type { NormalizedIframeBridgeConfig } from '../../../src/host/config';

describe('configureIframe', () => {
  test('applies sandbox and attributes before assigning src', () => {
    const writeOrder: string[] = [];
    const iframe = new RecordingIframe(writeOrder) as unknown as HTMLIFrameElement;

    configureIframe(iframe, createConfig());

    expect(writeOrder).toEqual([
      'sandbox',
      'allow',
      'allowFullscreen',
      'className',
      'id',
      'loading',
      'name',
      'referrerPolicy',
      'title',
      'src',
    ]);
  });
});

class RecordingIframe {
  constructor(private readonly writeOrder: string[]) {}

  set allow(_value: string) {
    this.writeOrder.push('allow');
  }

  set allowFullscreen(_value: boolean) {
    this.writeOrder.push('allowFullscreen');
  }

  set className(_value: string) {
    this.writeOrder.push('className');
  }

  set id(_value: string) {
    this.writeOrder.push('id');
  }

  set loading(_value: string) {
    this.writeOrder.push('loading');
  }

  set name(_value: string) {
    this.writeOrder.push('name');
  }

  set referrerPolicy(_value: string) {
    this.writeOrder.push('referrerPolicy');
  }

  set src(_value: string) {
    this.writeOrder.push('src');
  }

  set title(_value: string) {
    this.writeOrder.push('title');
  }

  setAttribute(name: string): void {
    this.writeOrder.push(name);
  }
}

function createConfig(): NormalizedIframeBridgeConfig {
  return {
    allowedOrigin: 'https://child.example',
    bootstrap: {
      handshakeTimeoutMs: 1000,
      parentOrigin: {
        enabled: true,
        location: 'query',
        paramName: '__parent',
        value: 'https://host.example',
      },
      session: {
        location: 'query',
        paramName: '__session',
        paramValue: 'session-1',
      },
    },
    container: {} as Element,
    iframeAttributes: {
      allow: 'fullscreen',
      allowFullscreen: true,
      className: 'embedded-child',
      id: 'child-frame',
      loading: 'lazy',
      name: 'child',
      referrerPolicy: 'no-referrer',
      title: 'Embedded child',
    },
    queue: {
      enabled: true,
      maxSize: 10,
    },
    replaceContainerContent: false,
    sandbox: 'allow-scripts',
    securityProfile: 'development',
    targetOrigin: 'https://child.example',
    timeouts: {
      operationTimeoutMs: 1000,
    },
    url: new URL('https://child.example/app'),
    warnings: [],
  };
}
