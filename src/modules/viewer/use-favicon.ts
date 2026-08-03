import { useEffect } from 'react';

const platformFavicons = {
  scoresaber: '/scoresaber.svg',
  beatleader: '/beatleader.svg',
  beatsaver: '/beatsaver.svg',
  default: null,
};

type Platform = keyof typeof platformFavicons;

function setFavicon(href: string, rel: string) {
  const existing = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (existing !== null) {
    existing.href = href;
  } else {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    document.head.appendChild(link);
  }
}

function restoreDefaultFavicons() {
  setFavicon('/TemplateData/favicon-32x32.png', 'icon');
  setFavicon('/TemplateData/apple-touch-icon.png', 'apple-touch-icon');
}

/**
 * Imperatively updates the favicon based on which platform's content is currently loaded in the viewer.
 */
export function useFavicon(platform: Platform) {
  useEffect(() => {
    const faviconSvg = platformFavicons[platform];
    if (faviconSvg !== null) {
      for (const rel of ['icon', 'apple-touch-icon']) {
        setFavicon(faviconSvg, rel);
      }
    } else {
      restoreDefaultFavicons();
    }
  }, [platform]);
}
