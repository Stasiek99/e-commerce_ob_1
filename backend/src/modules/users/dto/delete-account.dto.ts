import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentPassword?: string;
}
