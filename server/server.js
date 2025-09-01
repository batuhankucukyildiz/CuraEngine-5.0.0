const express = require("express");
const app = express();
const multer = require("multer");
const path = require("path");
require("dotenv").config();
const { dirname } = require("path");
const { sliceModel } = require("./slice"); // Aşağıdaki yeni slice.js
const appDir = dirname(require.main.filename);

app.use(express.urlencoded({ extended: false, limit: "50mb" }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, `${appDir}/uploads`),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

app.get("/", (_req, res) => res.send("hi"));

app.post("/slice", upload.single("uploaded_file"), async (req, res) => {
  try {
    const { costPerGram, costPerHour, material, filamentDiameterMm, materialE0, materialE1 } = req.body;
    if (!req.file) return res.status(400).json({ error: "File is required (uploaded_file)" });
    if (!costPerGram || !costPerHour) {
      return res.status(400).json({ error: "costPerGram and costPerHour are required in request body" });
    }

    const inputFilename = req.file.filename;

    const result = await sliceModel({
      inputFilename,
      material,              // tek materyal (E0/E1 aynı)
      materialE0,            // opsiyonel: E0 materyali
      materialE1,            // opsiyonel: E1 materyali
      filamentDiameterMm: filamentDiameterMm ? parseFloat(filamentDiameterMm) : undefined,
    });

    const price = calculatePrice(
      {
        printTimeSeconds: result.printTimeSeconds,
        filamentWeightGrams: result.filamentWeightGrams,
      },
      parseFloat(costPerGram),
      parseFloat(costPerHour)
    );

    const gcodeFileName = `${inputFilename.split(".")[0]}.gcode`;

    res.json({
      message: "Slicing completed",
      file: inputFilename,
      printTimeSeconds: result.printTimeSeconds,
      printTimeHours: parseFloat((result.printTimeSeconds / 3600).toFixed(2)),
      filamentVolumeMM3: result.filamentVolumeMM3,
      filamentLengthMeters: result.filamentLengthMeters,   // yeni
      filamentWeightGrams: result.filamentWeightGrams,
      filamentWeightKg: parseFloat((result.filamentWeightGrams / 1000).toFixed(3)),
      partDimensionsMm: result.partDimensionsMm,           // { xWidth, yDepth, zHeight }
      partWeightGrams: result.filamentWeightGrams,         // toplam ekstrüzyon (support dahil olabilir)
      partWeightKg: parseFloat((result.filamentWeightGrams / 1000).toFixed(3)),
      materialUsed: result.materialUsed,                   // E0/E1 hangi materyal
      price,
      gcodeDownloadUrl: `/download/${gcodeFileName}`,
      command: result.command,                             // debug için
    });

  } catch (err) {
    console.error("❌ Slicing failed:", err);
    res.status(500).json({ error: "Slicing failed", details: String(err.message || err) });
  }
});

function calculatePrice({ printTimeSeconds, filamentWeightGrams }, costPerGram, costPerHour) {
  const timeInHours = printTimeSeconds / 3600;
  const timeCost = timeInHours * costPerHour;
  const materialCost = filamentWeightGrams * costPerGram;
  const total = timeCost + materialCost;
  return {
    timeCost: parseFloat(timeCost.toFixed(2)),
    materialCost: parseFloat(materialCost.toFixed(2)),
    total: parseFloat(total.toFixed(2)),
    currency: "EUR",
  };
}

app.listen(PORT, () => console.log(`server running on ${PORT}`));
