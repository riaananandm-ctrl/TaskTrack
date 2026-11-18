-- Christmas mode is a cosmetic unlock. Like the other codes, the code itself is
-- added straight to redeem_codes, not written here.
ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_unlocks_check;
ALTER TABLE redeem_codes ADD CONSTRAINT redeem_codes_unlocks_check CHECK (unlocks IN ('polish', 'detector', 'christmas'));
