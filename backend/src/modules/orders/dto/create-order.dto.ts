import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CarrierCode } from '@prisma/client';

class NewAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  company?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  street!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @IsString()
  @Matches(/^\d{2}-\d{3}$/, { message: 'postalCode must be in format XX-XXX' })
  postalCode!: string;

  @IsOptional()
  @IsIn(['PL'], { message: 'Shipping is only available to Poland (PL) — UN 1266 dangerous goods restriction' })
  country?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsUUID()
  addressId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewAddressDto)
  newAddress?: NewAddressDto;

  @IsEnum(CarrierCode)
  carrierCode!: CarrierCode;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  inpostLockerCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  dpdPickupPointCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  guestEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  termsVersion?: string;

  @IsOptional()
  @IsDateString()
  termsAcceptedAt?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'NIP must be exactly 10 digits' })
  nip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  couponCode?: string;

}
