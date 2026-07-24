import { IsNotEmpty, IsString } from 'class-validator';

/** Carries the opaque refresh token for /auth/refresh and /auth/logout. */
export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
