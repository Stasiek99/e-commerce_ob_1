import { IsNotEmpty, IsString } from 'class-validator';

export class ExchangeTokenDto {
  @IsString()
  @IsNotEmpty()
  nonce: string;
}
