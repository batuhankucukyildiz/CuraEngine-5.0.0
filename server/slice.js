const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { dirname } = require("path");
const appDir = dirname(require.main.filename);
const filePath = `${appDir}/uploads`;

function buildSettingsFlags(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `-s ${k}=${String(v).toLowerCase()}`)
    .join(" ");
}

// ---- Malzeme presetleri ----
const MATERIALS = {
  PLA: {
    density_g_cm3: 1.24,
    e0: { temp: 200, temp0: 205, temp_layer0: 210 },
    e1: { temp: 200, temp0: 205, temp_layer0: 210 },
  },
  PETG: {
    density_g_cm3: 1.27,
    e0: { temp: 235, temp0: 240, temp_layer0: 245 },
    e1: { temp: 235, temp0: 240, temp_layer0: 245 },
  },
  ABS: {
    density_g_cm3: 1.04,
    e0: { temp: 240, temp0: 245, temp_layer0: 250 },
    e1: { temp: 240, temp0: 245, temp_layer0: 250 },
  },
  ASA: {
    density_g_cm3: 1.07,
    e0: { temp: 245, temp0: 250, temp_layer0: 255 },
    e1: { temp: 245, temp0: 250, temp_layer0: 255 },
  },
  NYLON: {
    density_g_cm3: 1.15,
    e0: { temp: 250, temp0: 255, temp_layer0: 260 },
    e1: { temp: 250, temp0: 255, temp_layer0: 260 },
  },
};

// ---- Genel/Extruder ayarları ----
const generalSettings = {
  // Senin zaten olanlar:
  acceleration_enabled: true,
  adaptive_layer_height_enabled: true,
  adhesion_extruder_nr: 1,
  adhesion_type: "raft",
  layer_height: 0.28,
  layer_height_0: 0.4,
  prime_tower_enable: true,
  prime_tower_position_x: 75,
  prime_tower_position_y: 95,
  prime_tower_size: 35,
  raft_interface_layers: 3,
  raft_interface_thickness: 0.2,

  // 🔧 Eksik olan zorunlular:
  material_shrinkage_percentage_x: 100,
  material_shrinkage_percentage_y: 100,
  material_shrinkage_percentage_z: 100,
  material_shrinkage_percentage_xy: 100,
  relative_extrusion: false,
  machine_head_polygon: "",
  machine_head_with_fans_polygon: "",
  machine_disallowed_areas: "",
  nozzle_disallowed_areas: "",

  // Soğutma
  cool_fan_speed: 100,
  cool_fan_speed_max: 100,
  cool_min_speed: 10,
  cool_fan_full_at_height: 0.3,

  // Retraction
  retraction_amount: 6.5,
  retraction_speed: 25,
  retraction_min_travel: 1.5,
  retraction_hop_enabled: false,

  // Support
  support_pattern: "zigzag",
  support_angle: 60,
  support_z_distance: 0.2,
  support_xy_distance: 0.7,

  // Speed (örnek, ihtiyacına göre değiştir)
  speed_layer_0: 20,
  speed_print: 60,
  speed_travel: 150,
  speed_wall: 40,
  speed_wall_0: 35,
  speed_wall_x: 50,
  speed_topbottom: 30,
  speed_support: 60,
  speed_support_interface: 40,
};

const baseE0 = {
  acceleration_infill: 1500,
  acceleration_print: 2000,
  line_width: 0.45,
  material_flow: 96,
  material_flow_layer_0: 98,
  speed_print: 20,
  speed_travel: 175,
  wall_thickness: 0.8,
};
const baseE1 = {
  ...baseE0,
  acceleration_infill: 2000,
  acceleration_print: 2400,
  speed_print: 40,
};

// ---------- STDOUT HEADER PARSER ----------
function parseStdoutHeader(stdout) {
  try {
    console.log("Parsing stdout for header info..."); // DEBUG
    
    // Header başlangıç ve bitiş noktalarını bul
    const start = stdout.indexOf(";START_OF_HEADER");
    const end = stdout.indexOf(";END_OF_HEADER");
    
    if (start === -1 || end === -1) {
      console.log("Header markers not found in stdout!"); // DEBUG
      return {};
    }
    
    const headerText = stdout.slice(start, end + ";END_OF_HEADER".length);
    console.log("Found header in stdout, length:", headerText.length); // DEBUG
    
    return parseHeaderContent(headerText);
    
  } catch (error) {
    console.error("Error parsing stdout header:", error);
    return {};
  }
}
function parseHeaderBlock(gcodePath) {
  try {
    console.log(`Attempting to read file: ${gcodePath}`); // DEBUG
    
    if (!fs.existsSync(gcodePath)) {
      console.log("File does not exist!"); // DEBUG
      return {};
    }
    
    const text = fs.readFileSync(gcodePath, "utf-8");
    console.log(`File read successfully, length: ${text.length}`); // DEBUG
    
    // İlk VE son birkaç satırı logla
    const lines = text.split('\n');
    console.log("First 5 lines:", lines.slice(0, 5)); // DEBUG
    console.log("Last 10 lines:", lines.slice(-10)); // DEBUG
    
    // Header başta VE sonda ara
    let start = text.indexOf(";START_OF_HEADER");
    let end = text.indexOf(";END_OF_HEADER");
    
    console.log(`Header positions - start: ${start}, end: ${end}`); // DEBUG
    
    // Eğer başta yoksa, sonda ara
    if (start === -1 || end === -1) {
      console.log("Header not found at beginning, checking end of file..."); // DEBUG
      
      // Son 50 satırda ara
      const lastLines = lines.slice(-50).join('\n');
      start = lastLines.indexOf(";START_OF_HEADER");
      end = lastLines.indexOf(";END_OF_HEADER");
      
      if (start !== -1 && end !== -1) {
        console.log("Header found at end of file!"); // DEBUG
        const headerText = lastLines.slice(start, end);
        return parseHeaderContent(headerText);
      }
      
      // Fallback: Header olmadan direkt arama (tüm dosyada)
      console.log("Trying fallback parsing on entire file..."); // DEBUG
      return parseHeaderContent(text);
    }
    
    // Normal header parsing (başta bulundu)
    const headerText = text.slice(start, end);
    console.log("Header found at beginning, length:", headerText.length); // DEBUG
    return parseHeaderContent(headerText);
    
  } catch (error) {
    console.error("Error parsing header:", error);
    return {};
  }
}

// Header içeriğini parse eden yardımcı fonksiyon
function parseHeaderContent(headerText) {
  const getValue = (key) => {
    // Negatif sayıları da destekleyen regex
    const regex = new RegExp(`;${key.replace('.', '\\.')}:(-?\\d+(?:\\.\\d+)?)`, 'i');
    const match = headerText.match(regex);
    console.log(`Regex for ${key}: Match = ${match ? match[1] : 'null'}`); // DEBUG
    return match ? parseFloat(match[1]) : undefined;
  };

  // Boyutlar
  const minX = getValue("PRINT.SIZE.MIN.X");
  const minY = getValue("PRINT.SIZE.MIN.Y");
  const minZ = getValue("PRINT.SIZE.MIN.Z");
  const maxX = getValue("PRINT.SIZE.MAX.X");
  const maxY = getValue("PRINT.SIZE.MAX.Y");
  const maxZ = getValue("PRINT.SIZE.MAX.Z");

  // Süre
  const printTimeS = getValue("PRINT.TIME");

  // Extruder hacimleri 
  const volE0 = getValue("EXTRUDER_TRAIN.0.MATERIAL.VOLUME_USED");
  const volE1 = getValue("EXTRUDER_TRAIN.1.MATERIAL.VOLUME_USED");

  // Nozzle çapı
  const nozE0 = getValue("EXTRUDER_TRAIN.0.NOZZLE.DIAMETER");
  const nozE1 = getValue("EXTRUDER_TRAIN.1.NOZZLE.DIAMETER");

  console.log("Extracted values:", { volE0, volE1, printTimeS, minX, maxX }); // DEBUG

  return {
    dims:
      minX != null &&
      maxX != null &&
      minY != null &&
      maxY != null &&
      minZ != null &&
      maxZ != null
        ? {
            xWidth: parseFloat((maxX - minX).toFixed(2)),
            yDepth: parseFloat((maxY - minY).toFixed(2)),
            zHeight: parseFloat((maxZ - minZ).toFixed(2)),
          }
        : undefined,
    printTimeSeconds: printTimeS,
    volumes: { e0: volE0, e1: volE1 },
    nozzles: { e0: nozE0, e1: nozE1 },
  };
}

// mm³ → m (filament uzunluğu) - DÜZELTİLDİ
function volumeToLengthMeters(volume_mm3, diameter_mm) {
  if (!Number.isFinite(volume_mm3) || volume_mm3 <= 0) return 0;
  if (!Number.isFinite(diameter_mm) || diameter_mm <= 0) return 0;
  
  const radius_mm = diameter_mm / 2;
  const area_mm2 = Math.PI * radius_mm * radius_mm;
  const length_mm = volume_mm3 / area_mm2;
  const length_m = length_mm / 1000;
  
  return parseFloat(length_m.toFixed(3));
}

// mm³ → g (yoğunluk g/cm³) - DÜZELTİLDİ
function volumeToGrams(volume_mm3, density_g_cm3) {
  if (!Number.isFinite(volume_mm3) || volume_mm3 <= 0) return 0;
  if (!Number.isFinite(density_g_cm3) || density_g_cm3 <= 0) return 0;
  
  const volume_cm3 = volume_mm3 / 1000; // mm³ to cm³
  const weight_g = volume_cm3 * density_g_cm3;
  
  return parseFloat(weight_g.toFixed(2));
}

// ---- Slicing ana fonksiyonu ----
async function sliceModel({
  inputFilename,
  material,     
  materialE0,
  materialE1,
  filamentDiameterMm = 1.75, // varsayılan değer
  filamentDiameterE0Mm,
  filamentDiameterE1Mm,
}) {
  const appDir        = __dirname;
  const resourcesDir  = path.join(appDir, "resources");
  const definitionsDir = path.join(resourcesDir, "definitions");
  const extrudersDir   = appDir; // çünkü extruder dosyaların server/ dizininde
  
  const printerDef    = path.join(definitionsDir, "ultimaker3.def.json");
  const extruderLeft  = path.join(extrudersDir, "ultimaker3_extruder_left.def.json");
  const extruderRight = path.join(extrudersDir, "ultimaker3_extruder_right.def.json");
  
  const printerId     = "ultimaker3";

  // Malzeme presetleri
  const matE0Name = (materialE0 || material || "PLA").toUpperCase();
  const matE1Name = (materialE1 || material || "PLA").toUpperCase();
  const matE0 = MATERIALS[matE0Name] || MATERIALS.PLA;
  const matE1 = MATERIALS[matE1Name] || MATERIALS.PLA;

  // Sıcaklıkları uygula
  const e0Settings = {
    ...baseE0,
    material_initial_print_temperature: matE0.e0.temp0,
    material_print_temperature: matE0.e0.temp,
    material_print_temperature_layer_0: matE0.e0.temp_layer0,
  };
  const e1Settings = {
    ...baseE1,
    material_initial_print_temperature: matE1.e1.temp0,
    material_print_temperature: matE1.e1.temp,
    material_print_temperature_layer_0: matE1.e1.temp_layer0,
  };

  const outputPath = `${appDir}/outputs/${inputFilename.split(".")[0]}.gcode`;
  console.log(`📁 App directory: ${appDir}`); // DEBUG
  console.log(`📄 Output path: ${outputPath}`); // DEBUG
  console.log(`📋 Input filename: ${inputFilename}`); // DEBUG
  const generalFlags = buildSettingsFlags(generalSettings);
  const e0Flags = buildSettingsFlags(e0Settings);
  const e1Flags = buildSettingsFlags(e1Settings);

  const command = [
    "CuraEngine slice -v",
    `-j "${printerDef}"`,
    `-j "${extruderLeft}"`,
    `-j "${extruderRight}"`,
    `-d ${printerId}`,
    `-o "${outputPath}"`,
    generalFlags,
    "-e0",
    e0Flags,
    "--next",
    "-e1",
    e1Flags,
    "-s print_statistics=true",
    `-l "${path.join(filePath, inputFilename)}"`,
  ].join(" ");

  let output;
  try {
    output = execSync(command + " 2>&1", { encoding: "utf-8" });
    console.log("CuraEngine Output:\n", output);
  } catch (err) {
    console.error("❌ CuraEngine error:", err.message);
    throw err;
  }

  // ---- STDOUT'dan Header Parse Et ----
  const hdr = parseStdoutHeader(output);
  console.log("Parsed stdout header data:", JSON.stringify(hdr, null, 2)); // DEBUG

  // Süre
  let printTimeSeconds = hdr.printTimeSeconds;
  if (!Number.isFinite(printTimeSeconds)) {
    const m = output.match(/Print time \(s\):\s*(\d+)/);
    if (m) printTimeSeconds = parseInt(m[1], 10);
  }

  // Extruder hacimleri
  const volE0 = hdr.volumes?.e0 || 0;
  const volE1 = hdr.volumes?.e1 || 0;
  const filamentVolumeMM3 = volE0 + volE1;

  console.log(`📊 Final values - E0: ${volE0} mm³, E1: ${volE1} mm³, Time: ${printTimeSeconds}s`); // DEBUG

  // Çaplar (öncelik sırası: spesifik > genel > varsayılan)
  const dE0 = filamentDiameterE0Mm || filamentDiameterMm;
  const dE1 = filamentDiameterE1Mm || filamentDiameterMm;

  console.log(`Diameter E0: ${dE0}mm, Diameter E1: ${dE1}mm`); // DEBUG
  console.log(`Material E0: ${matE0Name} (density: ${matE0.density_g_cm3}), Material E1: ${matE1Name} (density: ${matE1.density_g_cm3})`); // DEBUG

  // Uzunluklar (m)
  const lenE0m = volumeToLengthMeters(volE0, dE0);
  const lenE1m = volumeToLengthMeters(volE1, dE1);
  const filamentLengthMeters = parseFloat((lenE0m + lenE1m).toFixed(3));

  // Ağırlıklar (g)
  const wE0g = volumeToGrams(volE0, matE0.density_g_cm3);
  const wE1g = volumeToGrams(volE1, matE1.density_g_cm3);
  const filamentWeightGrams = parseFloat((wE0g + wE1g).toFixed(2));

  console.log(`Length E0: ${lenE0m}m, Length E1: ${lenE1m}m, Total: ${filamentLengthMeters}m`); // DEBUG
  console.log(`Weight E0: ${wE0g}g, Weight E1: ${wE1g}g, Total: ${filamentWeightGrams}g`); // DEBUG

  // Boyutlar
  const partDimensionsMm = hdr.dims;

  return {
    command,
    outputPath,
    printTimeSeconds,
    printTimeHours: Number.isFinite(printTimeSeconds)
      ? parseFloat((printTimeSeconds / 3600).toFixed(2))
      : undefined,

    // Toplamlar
    filamentVolumeMM3: filamentVolumeMM3 > 0 ? filamentVolumeMM3 : undefined,
    filamentLengthMeters: filamentLengthMeters > 0 ? filamentLengthMeters : undefined,
    filamentWeightGrams: filamentWeightGrams > 0 ? filamentWeightGrams : undefined,
    filamentWeightKg: filamentWeightGrams > 0 
      ? parseFloat((filamentWeightGrams / 1000).toFixed(3))
      : undefined,

    // Extruder kırılımı
    perExtruder: {
      E0: {
        material: matE0Name,
        volumeMM3: volE0 > 0 ? volE0 : undefined,
        filamentDiameterMm: dE0,
        lengthMeters: lenE0m > 0 ? lenE0m : undefined,
        weightGrams: wE0g > 0 ? wE0g : undefined,
      },
      E1: {
        material: matE1Name,
        volumeMM3: volE1 > 0 ? volE1 : undefined,
        filamentDiameterMm: dE1,
        lengthMeters: lenE1m > 0 ? lenE1m : undefined,
        weightGrams: wE1g > 0 ? wE1g : undefined,
      },
    },

    // Boyutlar ve malzemeler
    partDimensionsMm,
    materialUsed: { E0: matE0Name, E1: matE1Name },
  };
}

module.exports = { sliceModel };