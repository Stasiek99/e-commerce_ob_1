import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ReturnType {
  WITHDRAWAL = 'WITHDRAWAL',
  COMPLAINT = 'COMPLAINT',
}

export enum RequestedResolution {
  REPAIR = 'REPAIR',
  REPLACEMENT = 'REPLACEMENT',
  PRICE_REDUCTION = 'PRICE_REDUCTION',
  REFUND = 'REFUND',
}

export class ReturnItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  productName: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateReturnRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  orderNumber: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsEnum(ReturnType)
  type: ReturnType;

  // ISO date string (YYYY-MM-DD) — establishes the 14-day withdrawal window
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  // Required for COMPLAINT — Art. 43c Ustawy o prawach konsumenta; optional for WITHDRAWAL.
  // @ValidateIf condition = false → all validators skipped, so undefined passes for WITHDRAWAL.
  @ValidateIf(o => o.type === ReturnType.COMPLAINT)
  @IsString()
  @MinLength(10, { message: 'Opis wady musi mieć co najmniej 10 znaków' })
  @MaxLength(2000)
  reason?: string;

  // Required for COMPLAINT — Art. 43d Ustawy o prawach konsumenta
  @IsOptional()
  @IsEnum(RequestedResolution)
  requestedResolution?: RequestedResolution;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/, { message: 'Nieprawidłowy format numeru IBAN' })
  @MaxLength(34)
  bankAccount?: string;

  // Required to be true for WITHDRAWAL — Art. 38 pkt 5 UoK exempts opened hygiene goods.
  // Optional for COMPLAINT (seal state is irrelevant to warranty claims).
  @IsOptional()
  @IsBoolean()
  sealedOnReturn?: boolean;
}
