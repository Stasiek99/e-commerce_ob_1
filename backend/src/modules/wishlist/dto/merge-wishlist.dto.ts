import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class MergeWishlistDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(4, { each: true })
  productIds!: string[];
}
