import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddToCartDto {
  @IsUUID()
  productVariantId!: string;

  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}
