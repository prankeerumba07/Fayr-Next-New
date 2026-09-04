-- CreateTable
CREATE TABLE "shop_sign_ins" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "howWeKnew" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_sign_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_sign_ins_platform_idx" ON "shop_sign_ins"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "shop_sign_ins_userId_platform_key" ON "shop_sign_ins"("userId", "platform");

-- AddForeignKey
ALTER TABLE "shop_sign_ins" ADD CONSTRAINT "shop_sign_ins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
