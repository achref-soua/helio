-- CreateTable
CREATE TABLE "sso_provider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "oidc_config" TEXT,
    "saml_config" TEXT,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "organization_id" TEXT,

    CONSTRAINT "sso_provider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_provider_provider_id_key" ON "sso_provider"("provider_id");

-- CreateIndex
CREATE INDEX "sso_provider_user_id_idx" ON "sso_provider"("user_id");

-- CreateIndex
CREATE INDEX "sso_provider_organization_id_idx" ON "sso_provider"("organization_id");

-- AddForeignKey
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
