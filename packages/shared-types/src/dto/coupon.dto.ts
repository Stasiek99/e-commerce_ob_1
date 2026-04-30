import { DiscountType, CouponType } from '../enums';

export interface ValidateCouponDto {
  code: string;
  cartTotalInCents: number;
  variantIds?: string[];
}

export interface CouponValidationResultDto {
  valid: boolean;
  discountType?: DiscountType;
  discountAmountInCents?: number;
  message?: string;
}

export interface CreateCouponDto {
  code: string;
  discountType: DiscountType;
  value: number;
  couponType?: CouponType;
  minSpendInCents?: number;
  maxUsesTotal?: number;
  maxUsesPerUser?: number;
  isActive?: boolean;
  startsAt?: string;
  expiresAt?: string;
  excludedProductIds?: string[];
}

export interface UpdateCouponDto {
  isActive?: boolean;
  expiresAt?: string;
  maxUsesTotal?: number;
  maxUsesPerUser?: number;
}

export interface CouponDto {
  id: string;
  code: string;
  discountType: DiscountType;
  value: number;
  couponType: CouponType;
  minSpendInCents?: number | null;
  maxUsesTotal?: number | null;
  maxUsesPerUser?: number | null;
  currentUses: number;
  isActive: boolean;
  startsAt?: string | null;
  expiresAt?: string | null;
  excludedProductIds: string[];
  createdAt: string;
}
