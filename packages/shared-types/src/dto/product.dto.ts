import { CarrierCode } from '../enums';

export interface ProductVariantDto {
  id: string;
  sku: string;
  label: string;
  volume?: number;
  priceInCents: number;
  compareAtPriceInCents?: number;
  stock: number;
  isActive: boolean;
}

export interface ProductImageDto {
  id: string;
  url: string;
  altText?: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  shortDescription?: string;
  brand?: string;
  scentFamily?: string;
  notes: string[];
  gender?: string;
  line?: string;
  categoryId: string;
  isActive: boolean;
  isFeatured: boolean;
  variants: ProductVariantDto[];
  images: ProductImageDto[];
}

export interface ProductListItemDto {
  id: string;
  name: string;
  slug: string;
  shortDescription?: string;
  brand?: string;
  scentFamily?: string;
  gender?: string;
  primaryImage?: ProductImageDto;
  lowestPriceInCents: number;
}

export interface ProductQueryDto {
  page?: number;
  limit?: number;
  category?: string;
  brand?: string;
  gender?: string[];
  scentFamily?: string[];
  line?: string[];
  volumes?: string[];
  inStock?: boolean;
  sortBy?: 'newest' | 'price_asc' | 'price_desc';
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  featured?: boolean;
}

export interface ProductFacetsDto {
  scentFamilies: string[];
  genders: string[];
}

export interface ShippingRateDto {
  carrier: CarrierCode;
  name: string;
  description: string;
  priceInCents: number;
  estimatedDays: string;
}
