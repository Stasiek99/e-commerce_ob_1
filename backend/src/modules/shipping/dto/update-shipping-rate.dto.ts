import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateShippingRateDto {
  @IsInt()
  @Min(0)
  priceInCents!: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
