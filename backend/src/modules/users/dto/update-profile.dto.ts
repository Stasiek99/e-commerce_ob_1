import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidNipChecksum } from '../../../common/utils/nip-checksum.util';

@ValidatorConstraint({ name: 'nipChecksum', async: false })
export class NipChecksumConstraint implements ValidatorConstraintInterface {
  validate(nip: string): boolean {
    return !!nip && isValidNipChecksum(nip);
  }

  defaultMessage(): string {
    return 'NIP checksum is invalid';
  }
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'NIP must be exactly 10 digits' })
  @Validate(NipChecksumConstraint)
  nip?: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
