import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ProductStatus } from '@prisma/client';

// Cross-field check for variant DTOs: a "was" price that doesn't exceed the current
// price isn't a discount and must not reach the DB (Omnibus directive compliance).
// On partial updates, only one of the two fields may be present in the payload — in
// that case there's nothing in the request to compare against, so this passes and
// attachOmnibusData() acts as the second line of defense at read time.
@ValidatorConstraint({ name: 'isGreaterThanPrice', async: false })
class IsGreaterThanPriceConstraint implements ValidatorConstraintInterface {
  validate(compareAtPriceInCents: number, args: ValidationArguments): boolean {
    if (compareAtPriceInCents == null) return true;
    const priceInCents = (args.object as { priceInCents?: number }).priceInCents;
    if (priceInCents == null) return true;
    return compareAtPriceInCents > priceInCents;
  }

  defaultMessage(): string {
    return 'compareAtPriceInCents must be greater than priceInCents';
  }
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsDateString()
  estimatedRestockDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  scentFamily?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pyramidTop?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pyramidHeart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pyramidBase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  catalogNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  line?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsDateString()
  estimatedRestockDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  scentFamily?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pyramidTop?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pyramidHeart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pyramidBase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  catalogNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  line?: string;
}

export class ProductQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : value ? [value] : undefined))
  gender?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : value ? [value] : undefined))
  scentFamily?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : value ? [value] : undefined))
  line?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : value ? [value] : undefined))
  volumes?: string[];

  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['relevance', 'price_asc', 'price_desc'])
  sortBy?: 'relevance' | 'price_asc' | 'price_desc';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  search?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxPrice?: number;
}

/**
 * Query for the fragrance finder's note matching.
 *
 * `notes` are normalized keys as handed out by `GET /products/finder/notes` —
 * the client must not invent them, and anything unrecognized simply fails to
 * overlap, so no validation against the live vocabulary is needed here.
 */
export class FinderMatchQueryDto {
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Transform(({ value }) => {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return raw.map((v: string) => String(v).trim()).filter(Boolean);
  })
  notes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : value ? [value] : undefined))
  gender?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  /** Product id to keep out of the results — the one currently being viewed. */
  @IsOptional()
  @IsUUID()
  exclude?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(48)
  limit?: number;
}

export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsOptional()
  @IsInt()
  volume?: number;

  @IsOptional()
  @IsInt()
  weight?: number;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsInt()
  @Min(0)
  priceInCents!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Validate(IsGreaterThanPriceConstraint)
  compareAtPriceInCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVariantStockDto {
  @ValidateIf((o) => o.adjustment === undefined)
  @IsInt()
  @Min(0)
  set?: number;

  @ValidateIf((o) => o.set === undefined)
  @IsInt()
  adjustment?: number;
}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsInt()
  volume?: number;

  @IsOptional()
  @IsInt()
  weight?: number;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceInCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Validate(IsGreaterThanPriceConstraint)
  compareAtPriceInCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
