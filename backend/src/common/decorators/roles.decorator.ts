import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../auth/guards/roles.guard';

/**
 * Decorator to restrict access to specific user roles.
 * @example @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
