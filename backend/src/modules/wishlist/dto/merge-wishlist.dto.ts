import { IsArray, IsUUID } from 'class-validator';

export class MergeWishlistDto {
  @IsArray()
  @IsUUID(4, { each: true })
  productIds!: string[];
}
