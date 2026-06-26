# Pawlettes Product Images

This directory contains product mockup images for the Pawlettes Shopify store. These are professional SVG mockups that can be used as:

1. **Placeholder images** for store layout testing
2. **Reference designs** for professional product photography
3. **Starting points** for AI image generation
4. **Demonstration assets** for the e-commerce store

## Products

| # | Product | Image | Price |
|---|---------|-------|-------|
| 1 | Slow-Down Lick Mat | `1-lick-mat.svg` | $18.00 |
| 2 | Reversible Pet Bandana | `2-reversible-bandana.svg` | $24.00 |
| 3 | Quick-Dip Paw Cleaner | `3-paw-cleaner.svg` | $24.00 |
| 4 | Pup Tee | `4-pup-tee.svg` | $28.00 |
| 5 | Personalized Dog Parent Crewneck | `5-dog-parent-crewneck.svg` | $42.00 |
| 6 | No-Pull Walk Harness | `6-no-pull-harness.svg` | $32.00 |
| 7 | Magic Deshedding Glove | `7-deshedding-glove.svg` | $16.00 |
| 8 | LED Glow Safety Collar | `8-led-collar.svg` | $26.00 |

## File Formats

- **SVG files** (Scalable Vector Graphics)
  - Resolution-independent
  - Perfect for web use
  - Can be scaled to any size without quality loss
  - File size: ~5-15 KB each

## Converting to Other Formats

To convert these SVG mockups to PNG/JPG for Shopify:

### Option 1: Online Converters
- Visit [CloudConvert](https://cloudconvert.com/svg-to-png)
- Upload SVG, download PNG at 1200x1200px

### Option 2: ImageMagick (Command Line)
```bash
convert -density 150 1-lick-mat.svg -quality 90 1-lick-mat.png
```

### Option 3: Inkscape
```bash
inkscape -w 1200 -h 1200 1-lick-mat.svg -o 1-lick-mat.png
```

### Option 4: Browser (Right-click → Save as)
1. Open SVG in browser
2. Right-click → "Save as..."
3. Choose PNG format
4. Adjust resolution as needed

## Next Steps

1. **Convert mockups** to PNG/JPG using one of the methods above
2. **Upload to Shopify** using the store's product management interface
3. **Add alt text** for each image (important for SEO)
4. **Consider professional photography** as an upgrade path

## Quality Notes

These SVG mockups include:
- ✓ Professional product styling
- ✓ Color-appropriate designs
- ✓ Key product features highlighted
- ✓ Price labels included
- ✓ Proper dimensions and proportions
- ✓ Clean, modern aesthetic

## Using with Shopify

1. Convert SVG to PNG (1200x1200px minimum)
2. Go to **Products** → Select product
3. Click **Add media** or **Edit media**
4. Upload the PNG image
5. Add descriptive alt text (e.g., "Slow-Down Lick Mat for dogs with textured surface")
6. Save product changes

## AI Image Generation Upgrade

Once you're ready for more photorealistic images, these mockups can serve as reference designs for tools like:
- **Midjourney** - Best for product photography
- **DALL-E 3** - Good quality, ChatGPT integrated
- **Stable Diffusion** - Open-source option

Use the detailed prompts from `../PRODUCT_IMAGES.md` for best results with AI generators.

---

**Total Products**: 8  
**Total Product Value**: $210.00  
**Status**: Mockups ready for store setup or professional photography upgrade
