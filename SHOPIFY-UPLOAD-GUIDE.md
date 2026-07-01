# Pawlettes Shopify Upload Guide

Complete step-by-step instructions for uploading products, images, and data to your Pawlettes Shopify store.

---

## Prerequisites

Before starting, you'll need:
- ✓ Shopify account access (admin at pawlettes.myshopify.com/admin)
- ✓ Storefront live at pawlette.shop
- ✓ Admin dashboard access
- ✓ Product images (SVG mockups or converted PNGs)
- ✓ Product data (PRODUCT_CATALOG.md)
- ✓ CSV import file (shopify-products-import.csv)

---

## Step 1: Convert SVG Mockups to PNG (Optional)

The product mockups are provided as SVG files, which are perfect for web. To convert them to PNG for Shopify:

### Option A: Using the Conversion Script (Recommended)

**Requirements:** Node.js with npm

```bash
# Navigate to the project directory
cd /path/to/pawlettes

# Install Sharp (image processing library)
npm install sharp

# Run the conversion script
node convert-svgs-to-png.js

# PNG files will be saved in: products/png-exports/
```

**Output:**
- 8 high-quality PNG files (1200x1200px)
- Optimized file sizes (typically 50-150 KB each)
- Ready for Shopify upload

### Option B: Using Online Converter

If you prefer not to install Node.js:

1. Visit [CloudConvert.com](https://cloudconvert.com/svg-to-png)
2. Upload each SVG file from `products/` folder
3. Set output settings:
   - **Format:** PNG
   - **Width:** 1200
   - **Height:** 1200
   - **Quality:** 90
4. Download converted PNG file
5. Create folder `products/png-exports/` and save all PNGs there

### Option C: Using Inkscape (Command Line)

If you have Inkscape installed:

```bash
cd products/
for file in *.svg; do
  inkscape -w 1200 -h 1200 "$file" -o "png-exports/${file%.svg}.png"
done
```

### Option D: Browser Method

1. Open SVG file in web browser
2. Right-click → "Save as..."
3. Select PNG format
4. Save with appropriate filename

---

## Step 2: Access Shopify Admin Dashboard

1. Go to [pawlettes.myshopify.com/admin](https://pawlettes.myshopify.com/admin)
2. Log in with your credentials
3. Navigate to **Products** in the left sidebar

---

## Step 3: Bulk Import Products Using CSV

This is the fastest way to add all products with descriptions and pricing:

### Steps:

1. From the Products page, click **Import** (top right)
2. Click **Select a CSV file** or drag and drop
3. Upload `shopify-products-import.csv` from the project directory
4. Shopify will preview the data
5. Click **Upload products**
6. Wait for import to complete (usually 1-2 minutes)

**What the CSV import includes:**
- ✓ Product titles and descriptions
- ✓ Pricing
- ✓ SKU codes
- ✓ Product types and tags
- ✓ Inventory quantities
- ✓ Product variants (sizes, colors)
- ✓ SEO metadata
- ✓ Image references

**Note:** The CSV includes image references (e.g., `1-lick-mat.png`). After importing, you'll need to upload the actual image files (see Step 4).

---

## Step 4: Upload Product Images

After bulk importing, you need to add the images to each product:

### Method 1: Upload Images After Import (Recommended)

1. From Products list, click first product (e.g., "Slow-Down Lick Mat")
2. Scroll down to **Media** section
3. Click **Add media**
4. Upload the corresponding PNG file (e.g., `1-lick-mat.png`)
5. The image will automatically match based on the filename reference in CSV
6. Repeat for all 8 products

### Method 2: Bulk Media Upload

For faster upload if you have multiple images:

1. From admin, go to **Settings** → **Files**
2. Click **Upload files**
3. Select all PNG files from `products/png-exports/` folder
4. Upload (this can take a few minutes for multiple files)
5. Then link images to products as in Method 1

### Method 3: Via CSV Re-import

If images are already uploaded to Shopify:

1. Update the CSV file with image URLs
2. Re-import with updated image references

---

## Step 5: Add Alt Text to Images (Important for SEO)

For each product image:

1. Open product page
2. Click on the product image in Media section
3. Click **Edit** (pencil icon)
4. Add descriptive alt text, for example:
   - "Slow-Down Lick Mat for dogs with textured surface"
   - "Reversible pet bandana with custom embroidery"
   - "Quick-Dip Paw Cleaner cup with soft silicone bristles"
   - etc.
5. Click **Save**

**Why it matters:** Alt text is crucial for:
- Accessibility for visually impaired users
- SEO ranking
- Image search visibility

---

## Step 6: Configure Product Personalization (For Custom Items)

For personalized products (Bandana, Tee, Crewneck), set up customization options:

### For "Reversible Pet Bandana":

1. Edit product page
2. Scroll to **Variants** section
3. Click **Add variant**
4. Option Name: **Personalization**
5. Option Value: **Custom with Name**
6. Add note to product description:
   - "Personalization: Custom embroidered name (up to 15 characters)"
   - "Processing time: 5-7 business days"

### For "Pup Tee" and "Dog Parent Crewneck":

Add note to product description about personalization:
- "Custom personalization available at checkout"
- "Specify dog's name and desired text style"
- "Processing time: 7-10 business days"

---

## Step 7: Set Up Product Collections

Group products by category for better navigation:

1. Go to **Products** → **Collections**
2. Click **Create collection**
3. Create these collections:
   - **Feeding & Mealtime** → Add: Slow-Down Lick Mat
   - **Grooming & Cleaning** → Add: Quick-Dip Paw Cleaner, Magic Deshedding Glove
   - **Apparel & Accessories** → Add: Bandana, Pup Tee, Crewneck
   - **Training & Walking** → Add: No-Pull Harness
   - **Safety & Visibility** → Add: LED Collar
   - **New Arrivals** → Add all 8 products

---

## Step 8: Configure Shipping Settings

1. Go to **Settings** → **Shipping and delivery**
2. Create shipping zones and rates based on product weights:
   - **Lightweight** (Bandana, Gloves): $5-7
   - **Medium** (Tees, Mats): $8-10
   - **Heavy** (Harness, Collar): $12-15
3. Set processing time:
   - Regular items: 1-2 business days
   - Personalized items: 5-10 business days

---

## Step 9: Enable Notifications

Set up order notifications:

1. Go to **Settings** → **Notifications**
2. Configure:
   - Order confirmation email
   - Personalization request instructions
   - Shipping notification
   - Delivery confirmation

Example personalization request instruction:
> "Your order includes custom personalization. Please reply to this email with the following details:
> - Dog's name (up to 15 characters)
> - Preferred text color/style
> - Any special requests
> 
> Processing begins once we receive your personalization details."

---

## Step 10: Configure Payment Settings

1. Go to **Settings** → **Payment providers**
2. Set up payment methods:
   - Shopify Payments (recommended)
   - PayPal
   - Apple Pay / Google Pay
   - Credit card options

---

## Step 11: Test Your Store

Before going live:

1. **Test a purchase:** Add items to cart, complete checkout
2. **Verify personalization:** Submit custom name, ensure it's captured
3. **Check mobile:** View store on phone/tablet
4. **Test images:** Ensure all product images load correctly
5. **Verify SEO:** Check that meta descriptions appear in search results

---

## Step 12: Launch & Promote

1. Set store to **Public** (Settings → General)
2. Verify custom domain is connected (pawlette.shop) under Settings → Domains
3. Enable SSL/HTTPS
4. Set up social media sharing
5. Create launch announcement email
6. Share with dog-loving communities

---

## File Structure Reference

```
pawlettes-repository/
├── PRODUCT_IMAGES.md              # AI image generation guide
├── PRODUCT_CATALOG.md             # Complete product descriptions
├── shopify-products-import.csv     # Bulk import file
├── convert-svgs-to-png.js         # Image conversion script
├── SHOPIFY-UPLOAD-GUIDE.md        # This file
└── products/
    ├── 1-lick-mat.svg
    ├── 2-reversible-bandana.svg
    ├── 3-paw-cleaner.svg
    ├── 4-pup-tee.svg
    ├── 5-dog-parent-crewneck.svg
    ├── 6-no-pull-harness.svg
    ├── 7-deshedding-glove.svg
    ├── 8-led-collar.svg
    ├── README.md
    └── png-exports/               # Generated PNGs (after conversion)
        ├── 1-lick-mat.png
        ├── 2-reversible-bandana.png
        ├── 3-paw-cleaner.png
        ├── 4-pup-tee.png
        ├── 5-dog-parent-crewneck.png
        ├── 6-no-pull-harness.png
        ├── 7-deshedding-glove.png
        └── 8-led-collar.png
```

---

## Troubleshooting

### Images not uploading
- Check file size (each PNG should be < 500 KB)
- Verify PNG format (not SVG)
- Try uploading one image at a time
- Clear browser cache and try again

### CSV import fails
- Ensure CSV is properly formatted (use provided file)
- Check that all column headers match exactly
- Verify no special characters in product names
- Try importing in smaller batches if file is too large

### Personalization not capturing
- Ensure product notes clearly state personalization details
- Add required personalization template to checkout
- Consider using Shopify apps for advanced personalization

### Shipping costs incorrect
- Verify weight values in product variants
- Update shipping zones with correct weight ranges
- Test shipping calculation in checkout

---

## Quick Upload Checklist

- [ ] SVG mockups converted to PNG (1200x1200px)
- [ ] PNG files saved in `products/png-exports/`
- [ ] CSV file ready for bulk import (`shopify-products-import.csv`)
- [ ] Logged into Shopify admin dashboard
- [ ] Bulk imported products via CSV
- [ ] Uploaded all 8 product images
- [ ] Added alt text to all images
- [ ] Configured personalization options
- [ ] Created product collections
- [ ] Set up shipping rates
- [ ] Tested store on desktop and mobile
- [ ] Store is public and live
- [ ] Social media sharing enabled

---

## Support Resources

- **Shopify Help:** https://help.shopify.com/
- **CSV Import Guide:** https://help.shopify.com/en/manual/products/import-export/importing-products
- **Image Best Practices:** https://help.shopify.com/en/manual/products/product-media
- **Personalization Apps:** https://apps.shopify.com/personalization

---

## Success Indicators

Your Pawlettes store is ready when:
- ✅ All 8 products visible on store
- ✅ Product images load correctly
- ✅ Pricing displays accurately
- ✅ Checkout process works
- ✅ Personalization capture works
- ✅ Shipping calculation accurate
- ✅ Mobile responsive design
- ✅ Store appears in search results

**Congratulations! Your Pawlettes store is now live! 🎉**
