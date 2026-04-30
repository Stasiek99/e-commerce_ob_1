import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  code!: string;

  @IsInt()
  @Min(0)
  cartTotalInCents!: number;

  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  variantIds?: string[];
}
