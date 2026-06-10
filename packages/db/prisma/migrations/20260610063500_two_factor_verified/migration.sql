-- Better-Auth 1.6 records whether an enrollment's first TOTP code has
-- verified; 2FA only activates after it does. Default true keeps any
-- pre-existing enrollment active.
ALTER TABLE "two_factor" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT true;
