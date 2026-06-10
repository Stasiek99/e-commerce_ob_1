-- Add sdsUrl to products for REACH Regulation 2020/878 SDS PDF attachment
ALTER TABLE "products" ADD COLUMN "sdsUrl" TEXT;
