import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';

const SITE_NAME = 'Fragrance Store';
const SITE_URL = 'https://fragrance-store.pl';
const DEFAULT_DESCRIPTION =
  'Perfumy, dyfuzory i żele pod prysznic premium. Starannie wyselekcjonowane zapachy dla wymagających.';
const DEFAULT_IMAGE = `${SITE_URL}/assets/og-default.jpg`;

export interface ProductSeoInput {
  name: string;
  brand?: string | null;
  shortDescription?: string | null;
  slug: string;
  images?: { url: string }[] | null;
  variants?: { priceInCents: number }[] | null;
}

export interface PageSeoInput {
  title: string;
  description?: string;
  path?: string;
  image?: string;
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  updateProductMeta(product: ProductSeoInput): void {
    const fullTitle = product.brand
      ? `${product.brand} ${product.name} | ${SITE_NAME}`
      : `${product.name} | ${SITE_NAME}`;
    const description =
      product.shortDescription?.trim() || DEFAULT_DESCRIPTION;
    const image = product.images?.[0]?.url ?? DEFAULT_IMAGE;
    const url = `${SITE_URL}/products/${product.slug}`;

    this.applyMeta({
      title: fullTitle,
      description,
      image,
      url,
      type: 'product',
    });
  }

  updatePageMeta(page: PageSeoInput): void {
    const fullTitle = `${page.title} | ${SITE_NAME}`;
    const description = page.description?.trim() || DEFAULT_DESCRIPTION;
    const image = page.image ?? DEFAULT_IMAGE;
    const url = `${SITE_URL}${this.normalizePath(page.path ?? this.router.url)}`;

    this.applyMeta({
      title: fullTitle,
      description,
      image,
      url,
      type: 'website',
    });
  }

  reset(): void {
    this.applyMeta({
      title: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      image: DEFAULT_IMAGE,
      url: SITE_URL,
      type: 'website',
    });
    this.clearJsonLd();
  }

  applyDefaults(path: string): void {
    this.applyMeta({
      title: SITE_NAME,
      description: DEFAULT_DESCRIPTION,
      image: DEFAULT_IMAGE,
      url: `${SITE_URL}${this.normalizePath(path)}`,
      type: 'website',
    });
    this.clearJsonLd();
  }

  setProductJsonLd(product: ProductSeoInput): void {
    const prices =
      product.variants?.map((v) => v.priceInCents).filter((p) => p > 0) ?? [];
    const lowestCents = prices.length ? Math.min(...prices) : 0;
    const highestCents = prices.length ? Math.max(...prices) : 0;
    const productUrl = `${SITE_URL}/products/${product.slug}`;
    const images = product.images?.map((i) => i.url) ?? [DEFAULT_IMAGE];

    const priceValidUntil = new Date();
    priceValidUntil.setFullYear(priceValidUntil.getFullYear() + 1);

    const offers =
      prices.length > 1
        ? {
            '@type': 'AggregateOffer',
            url: productUrl,
            priceCurrency: 'PLN',
            lowPrice: (lowestCents / 100).toFixed(2),
            highPrice: (highestCents / 100).toFixed(2),
            offerCount: prices.length,
            availability: 'https://schema.org/InStock',
          }
        : {
            '@type': 'Offer',
            url: productUrl,
            priceCurrency: 'PLN',
            price: (lowestCents / 100).toFixed(2),
            priceValidUntil: priceValidUntil.toISOString().slice(0, 10),
            availability: 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/NewCondition',
          };

    const jsonld: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      sku: product.slug,
      image: images,
      url: productUrl,
      offers,
    };

    if (product.shortDescription?.trim()) {
      jsonld['description'] = product.shortDescription.trim();
    }
    if (product.brand) {
      jsonld['brand'] = { '@type': 'Brand', name: product.brand };
    }

    this.upsertJsonLd(jsonld);
  }

  clearJsonLd(): void {
    const existing = this.document.getElementById('ld-product');
    if (existing) existing.remove();
  }

  private applyMeta(data: {
    title: string;
    description: string;
    image: string;
    url: string;
    type: 'website' | 'product';
  }): void {
    this.title.setTitle(data.title);

    this.upsertName('description', data.description);

    this.upsertProperty('og:site_name', SITE_NAME);
    this.upsertProperty('og:title', data.title);
    this.upsertProperty('og:description', data.description);
    this.upsertProperty('og:image', data.image);
    this.upsertProperty('og:url', data.url);
    this.upsertProperty('og:type', data.type);
    this.upsertProperty('og:locale', 'pl_PL');

    this.upsertName('twitter:card', 'summary_large_image');
    this.upsertName('twitter:title', data.title);
    this.upsertName('twitter:description', data.description);
    this.upsertName('twitter:image', data.image);

    this.setCanonical(data.url);
  }

  private upsertName(name: string, content: string): void {
    if (this.meta.getTag(`name="${name}"`)) {
      this.meta.updateTag({ name, content });
    } else {
      this.meta.addTag({ name, content });
    }
  }

  private upsertProperty(property: string, content: string): void {
    if (this.meta.getTag(`property="${property}"`)) {
      this.meta.updateTag({ property, content });
    } else {
      this.meta.addTag({ property, content });
    }
  }

  private setCanonical(url: string): void {
    const head = this.document.head;
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private upsertJsonLd(data: Record<string, unknown>): void {
    const head = this.document.head;
    let script = this.document.getElementById(
      'ld-product',
    ) as HTMLScriptElement | null;
    if (!script) {
      script = this.document.createElement('script') as HTMLScriptElement;
      script.id = 'ld-product';
      script.type = 'application/ld+json';
      head.appendChild(script);
    }
    script.textContent = JSON.stringify(data);
  }

  private normalizePath(path: string): string {
    if (!path || path === '/') return '';
    return path.startsWith('/') ? path : `/${path}`;
  }
}
