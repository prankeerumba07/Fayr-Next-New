-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'SUPPORT',
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "staffUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE INDEX "admin_audit_log_staffUserId_createdAt_idx" ON "admin_audit_log"("staffUserId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_log_targetUserId_createdAt_idx" ON "admin_audit_log"("targetUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

