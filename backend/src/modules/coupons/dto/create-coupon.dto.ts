import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CouponType, DiscountType } from '@prisma/client';

export class CreateCouponDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,32}$/, { message: 'Code must be 3–32 chars, uppercase letters/digits/hyphens/underscores' })
  code!: string;

  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @IsInt()
  @Min(0)
  @Max(10_000_00) // max 100 000 PLN fixed discount (in grosz)
  value!: number;

  @IsOptional()
  @IsEnum(CouponType)
  couponType?: CouponType;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSpendInCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  excludedProductIds?: string[];
}

export class UpdateCouponDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;
}
