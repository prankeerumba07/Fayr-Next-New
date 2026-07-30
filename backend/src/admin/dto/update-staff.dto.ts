import { IsIn, IsOptional } from 'class-validator';
import { STAFF_ROLES, STAFF_STATUSES } from '../admin.constants';

/**
 * Body for PATCH /admin/staff/:id — change a staff account's role and/or status
 * (ADMIN only). Both optional; the service rejects an empty patch. Email, name,
 * and password are intentionally not editable here.
 */
export class UpdateStaffDto {
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: (typeof STAFF_ROLES)[number];

  @IsOptional()
  @IsIn(STAFF_STATUSES)
  status?: (typeof STAFF_STATUSES)[number];
}
