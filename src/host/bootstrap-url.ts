import type { BootstrapParamLocation } from '../types/index.js';

export type BootstrapUrlConfig = {
  parentOrigin: {
    enabled: boolean;
    location: BootstrapParamLocation;
    paramName: string;
    value: string;
  };
  session: {
    location: BootstrapParamLocation;
    paramName: string;
    paramValue: string;
  };
};

export function buildBootstrapUrl(src: string | URL, bootstrap: BootstrapUrlConfig): URL {
  const url = new URL(src instanceof URL ? src.href : src);

  appendBootstrapParam(
    url,
    bootstrap.session.location,
    bootstrap.session.paramName,
    bootstrap.session.paramValue,
  );

  if (bootstrap.parentOrigin.enabled) {
    appendBootstrapParam(
      url,
      bootstrap.parentOrigin.location,
      bootstrap.parentOrigin.paramName,
      bootstrap.parentOrigin.value,
    );
  }

  return url;
}

function appendBootstrapParam(
  url: URL,
  location: BootstrapParamLocation,
  paramName: string,
  paramValue: string,
): void {
  if (location === 'query') {
    appendQueryParam(url, paramName, paramValue);
    return;
  }

  appendHashParam(url, paramName, paramValue);
}

function appendQueryParam(url: URL, paramName: string, paramValue: string): void {
  const param = new URLSearchParams([[paramName, paramValue]]).toString();
  const separator = url.search === '' ? '?' : url.search.endsWith('&') ? '' : '&';

  url.search = `${url.search}${separator}${param}`;
}

function appendHashParam(url: URL, paramName: string, paramValue: string): void {
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const separator = hash === '' ? '' : hash.includes('?') ? '&' : '?';
  const param = new URLSearchParams([[paramName, paramValue]]).toString();

  url.hash = `${hash}${separator}${param}`;
}
