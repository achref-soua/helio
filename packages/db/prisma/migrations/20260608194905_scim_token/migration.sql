-- CreateTable
CREATE TABLE "scim_token" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "scim_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scim_token_organization_id_key" ON "scim_token"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "scim_token_token_hash_key" ON "scim_token"("token_hash");

-- AddForeignKey
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
