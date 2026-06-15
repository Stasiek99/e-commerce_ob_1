import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StreetCheckDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}
