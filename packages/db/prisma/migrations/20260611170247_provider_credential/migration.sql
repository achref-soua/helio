-- CreateEnum
CREATE TYPE "ProviderCredentialKind" AS ENUM ('EMAIL_SMTP', 'EMAIL_POSTMARK', 'EMAIL_RESEND', 'EMAIL_MAILGUN', 'SMS_TWILIO', 'WHATSAPP_CLOUD', 'LLM', 'CHURN_ENDPOINT', 'IMPORT_HUBSPOT', 'IMPORT_MAILCHIMP', 'IMPORT_KLAVIYO');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "provider_credential" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "ProviderCredentialKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets" JSONB NOT NULL DEFAULT '{}',
    "secrets_meta" JSONB NOT NULL DEFAULT '{}',
    "status" "CredentialStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "last_verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_credential_organization_id_idx" ON "provider_credential"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_credential_organization_id_kind_name_key" ON "provider_credential"("organization_id", "kind", "name");

-- AddForeignKey
ALTER TABLE "provider_credential" ADD CONSTRAINT "provider_credential_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
