export interface CartItemDto {
  id: string;
  productVariantId: string;
  quantity: number;
  productName: string;
  variantLabel: string;
  priceInCents: number;
  imageUrl?: string;
  slug: string;
  sku: string;
  stock: number;
}

export interface CartDto {
  id: string;
  items: CartItemDto[];
  itemCount: number;
  totalInCents: number;
}

export interface AddToCartDto {
  productVariantId: string;
  quantity: number;
}

export interface UpdateCartItemDto {
  quantity: number;
}
