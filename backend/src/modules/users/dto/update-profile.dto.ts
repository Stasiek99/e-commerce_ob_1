import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'nipChecksum', async: false })
export class NipChecksumConstraint implements ValidatorConstraintInterface {
  validate(nip: string): boolean {
    if (!nip || !/^\d{10}$/.test(nip)) return false;
    const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    const digits = nip.split('').map(Number);
    const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0);
    return sum % 11 === digits[9];
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
}
