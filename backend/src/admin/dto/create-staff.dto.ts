import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { STAFF_PASSWORD_MIN_LENGTH, STAFF_ROLES } from '../admin.constants';

/** Body for POST /admin/staff — create a staff account (ADMIN only). */
export class CreateStaffDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(STAFF_ROLES)
  role!: (typeof STAFF_ROLES)[number];

  @IsString()
  @MinLength(STAFF_PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  password!: string;
}
