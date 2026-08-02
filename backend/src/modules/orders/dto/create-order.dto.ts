import {
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
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CarrierCode } from '@prisma/client';
import { CURRENT_TERMS_VERSION } from '@fragrance-store/shared-types';
import { NipChecksumConstraint } from '../../users/dto/update-profile.dto';

const TERMS_ACCEPTANCE_MAX_AGE_MS = 10 * 60 * 1000;

@ValidatorConstraint({ name: 'currentTermsVersion', async: false })
class CurrentTermsVersionConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    return value === CURRENT_TERMS_VERSION;
  }

  defaultMessage(): string {
    return `termsVersion must match the current published version (${CURRENT_TERMS_VERSION})`;
  }
}

@ValidatorConstraint({ name: 'recentTermsAcceptance', async: false })
class RecentTermsAcceptanceConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    const acceptedAt = new Date(value).getTime();
    if (Number.isNaN(acceptedAt)) return false;
    const ageMs = Date.now() - acceptedAt;
    return ageMs >= 0 && ageMs <= TERMS_ACCEPTANCE_MAX_AGE_MS;
  }

  defaultMessage(): string {
    return 'termsAcceptedAt must be a timestamp within the last 10 minutes';
  }
}

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

  @IsString()
  @MaxLength(10)
  @Validate(CurrentTermsVersionConstraint)
  termsVersion!: string;

  @IsDateString()
  @Validate(RecentTermsAcceptanceConstraint)
  termsAcceptedAt!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'NIP must be exactly 10 digits' })
  @Validate(NipChecksumConstraint)
  nip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  couponCode?: string;

  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

}
