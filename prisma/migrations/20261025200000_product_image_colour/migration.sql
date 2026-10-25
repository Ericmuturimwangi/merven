-- Optional colour for a product photo, so choosing a colour on the product page
-- can show a photo of that colour. NULL = the photo isn't tied to one colour.
-- Additive only: existing rows keep NULL and behave as before.

-- AlterTable
ALTER TABLE "product_image" ADD COLUMN     "colour" TEXT;
