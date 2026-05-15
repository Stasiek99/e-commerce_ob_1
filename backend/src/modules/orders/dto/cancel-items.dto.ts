import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CancelItemLineDto {
  @IsString()
  orderItemId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CancelItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancelItemLineDto)
  items: CancelItemLineDto[];
}