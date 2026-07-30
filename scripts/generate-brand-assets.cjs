const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const repositoryRoot = path.resolve(__dirname, "..");
const brandingRoot = path.join(
  repositoryRoot,
  "src",
  "TaxiNow.Web",
  "public",
  "branding"
);
const appAssetsRoot = path.join(
  repositoryRoot,
  "src",
  "TaxiNow.App",
  "Assets"
);
const wordmarkSource = path.join(
  brandingRoot,
  "concepts",
  "taxinow-logo-generated-concept.png"
);
const iconSource = path.join(
  brandingRoot,
  "concepts",
  "taxinow-app-icon-generated-concept.png"
);

fs.mkdirSync(appAssetsRoot, { recursive: true });

async function trimSource(source) {
  return sharp(source)
    .trim({ background: "#ffffff", threshold: 18 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function renderPicture(source, output, width, height) {
  await sharp(source)
    .resize(width, height, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function renderWordmark(source, output) {
  await sharp(source)
    .resize({ width: 1440 })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

function buildIco(images) {
  const headerLength = 6 + images.length * 16;
  let offset = headerLength;
  const header = Buffer.alloc(headerLength);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

async function main() {
  const wordmarkPicture = await trimSource(wordmarkSource);
  const iconPicture = await trimSource(iconSource);
  await renderWordmark(
    wordmarkPicture,
    path.join(brandingRoot, "taxinow-logo.png")
  );
  await renderPicture(
    iconPicture,
    path.join(brandingRoot, "taxinow-app-icon.png"),
    512,
    512
  );
  await renderPicture(
    iconPicture,
    path.join(appAssetsRoot, "TaxiNow.png"),
    512,
    512
  );

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    images.push({
      size,
      data: await sharp(iconPicture)
        .resize(size, size, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png({ compressionLevel: 9 })
        .toBuffer()
    });
  }
  fs.writeFileSync(
    path.join(appAssetsRoot, "TaxiNow.ico"),
    buildIco(images)
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
