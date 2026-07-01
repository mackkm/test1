#!/usr/bin/env node

/**
 * Convert SVG product mockups to PNG
 * Requires: npm install sharp
 * Usage: node convert-svgs-to-png.js
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is installed
let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('Error: sharp is not installed.');
  console.error('Please run: npm install sharp');
  console.error('Then run this script again.');
  process.exit(1);
}

const productsDir = path.join(__dirname, 'products');
const outputDir = path.join(__dirname, 'products', 'png-exports');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`✓ Created output directory: ${outputDir}`);
}

// Find all SVG files
const svgFiles = fs.readdirSync(productsDir)
  .filter(file => file.endsWith('.svg') && !file.includes('README'));

console.log(`\nFound ${svgFiles.length} SVG files to convert\n`);

// Convert each SVG to PNG
const convertSVG = async (svgFile) => {
  const inputPath = path.join(productsDir, svgFile);
  const outputFile = svgFile.replace('.svg', '.png');
  const outputPath = path.join(outputDir, outputFile);

  try {
    // Read SVG file
    const svgContent = fs.readFileSync(inputPath, 'utf8');

    // Convert SVG to PNG at 1200x1200px
    await sharp(Buffer.from(svgContent))
      .png({ quality: 90, compressionLevel: 9 })
      .resize(1200, 1200, {
        fit: 'contain',
        background: { r: 248, g: 248, b: 248 } // Light gray background
      })
      .toFile(outputPath);

    console.log(`✓ Converted: ${svgFile} → ${outputFile}`);
    console.log(`  Size: ${fs.statSync(outputPath).size} bytes`);

    return true;
  } catch (err) {
    console.error(`✗ Failed to convert ${svgFile}:`);
    console.error(`  ${err.message}`);
    return false;
  }
};

// Main conversion process
(async () => {
  console.log('Converting SVGs to PNG (1200x1200px)...\n');

  let successCount = 0;
  let failureCount = 0;

  for (const svgFile of svgFiles) {
    const success = await convertSVG(svgFile);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Conversion complete!`);
  console.log(`✓ Successful: ${successCount}`);
  console.log(`✗ Failed: ${failureCount}`);
  console.log(`\nOutput directory: ${outputDir}`);
  console.log(`\nReady to upload to Shopify!`);
})();
