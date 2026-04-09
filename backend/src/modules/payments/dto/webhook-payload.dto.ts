import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class WebhookPayloadDto {
  @IsInt()
  merchantId!: number;

  @IsInt()
  posId!: number;

  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsInt()
  amount!: number;

  @IsInt()
  originAmount!: number;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsInt()
  orderId!: number;

  @IsInt()
  methodId!: number;

  @IsString()
  statement!: string;

  @IsString()
  @IsNotEmpty()
  sign!: string;
}
