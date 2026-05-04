import { IsEmail, IsString } from 'class-validator';

export class MagicLinkRequestDto {
  @IsEmail()
  email: string;
}

export class MagicLinkVerifyDto {
  @IsString()
  token: string;
}
