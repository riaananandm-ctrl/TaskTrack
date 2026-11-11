-- Inter is now the TaskTrack default font. Every existing row still held the old
-- default ('plus-jakarta-sans'), which the app applies as an explicit choice, so move
-- those rows to the new default. Students who picked another font keep it, and
-- Plus Jakarta Sans stays available in Settings.

ALTER TABLE public.user_settings ALTER COLUMN font_family SET DEFAULT 'inter';

UPDATE public.user_settings
   SET font_family = 'inter'
 WHERE font_family = 'plus-jakarta-sans';
