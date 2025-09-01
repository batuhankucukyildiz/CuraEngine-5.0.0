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
  const definitionsDir = path.join(appDir, "resources", "definitions");
  const extrudersDir   = path.join(appDir, "resources", "extruders");
    
  // Malzeme presetleri
  const matE0Name = (materialE0 || material || "PLA").toUpperCase();
  const matE1Name = (materialE1 || material || "PLA").toUpperCase();
  const matE0 = MATERIALS[matE0Name] || MATERIALS.PLA;
  const matE1 = MATERIALS[matE1Name] || MATERIALS.PLA;

  const outputPath = `${appDir}/outputs/${inputFilename.split(".")[0]}.gcode`;
  console.log(`📁 App directory: ${appDir}`); // DEBUG
  console.log(`📄 Output path: ${outputPath}`); // DEBUG
  console.log(`📋 Input filename: ${inputFilename}`); // DEBUG

  const command = [
    "CuraEngine slice -v",
    `-j /root/cura-5.0.0/resources/definitions/ultimaker3.def.json`,
    `-j /root/cura-5.0.0/resources/extruders/ultimaker3_extruder_left.def.json`,
    `-j /root/cura-5.0.0/resources/extruders/ultimaker3_extruder_right.def.json`,
    `-o "${outputPath}"`,
    `-l "${path.join(filePath, inputFilename)}"`,
  
    // General
    `-s acceleration_enabled=True`,
    `-s adaptive_layer_height_enabled=True`,
    `-s adhesion_extruder_nr=1`,
    `-s adhesion_type=raft`,
    `-s adhesion_z_offset=0`,
    `-s build_volume_temperature=88`,
    `-s interlocking_enable=False`,
    `-s jerk_enabled=False`,
    `-s layer_height=0.3`,
    `-s layer_height_0=0.3`,
    `-s material_shrinkage_percentage=100.5`,
    `-s prime_tower_base_curve_magnitude=0.5`,
    `-s prime_tower_base_height=1.2`,
    `-s prime_tower_base_size=5`,
    `-s prime_tower_enable=True`,
    `-s prime_tower_min_shell_thickness=3`,
    `-s prime_tower_mode=normal`,
    `-s prime_tower_position_x=75`,
    `-s prime_tower_position_y=95`,
    `-s prime_tower_size=30`,
    `-s raft_interface_extruder_nr=0`,
    `-s raft_surface_remove_inside_corners=False`,
    `-s retraction_combing=all`,
    `-s support_bottom_extruder_nr=0`,
    `-s support_enable=True`,
    `-s support_extruder_nr=1`,
    `-s support_extruder_nr_layer_0=0`,
    `-s support_infill_extruder_nr=0`,
    `-s wall_extruder_nr=0`,
  
    // E0
    `-s acceleration_infill=1800`,
    `-s acceleration_print=2000`,
    `-s coasting_enable=True`,
    `-s cool_fan_enabled=False`,
    `-s cool_lift_head=True`,
    `-s cool_min_layer_time=15`,
    `-s flooring_layer_count=1`,
    `-s infill_material_flow=80`,
    `-s infill_overlap=10`,
    `-s infill_pattern=zigzag`,
    `-s infill_sparse_density=70`,
    `-s initial_layer_line_width_factor=105`,
    `-s inset_direction=outside_in`,
    `-s ironing_enabled=False`,
    `-s ironing_flow=12`,
    `-s ironing_line_spacing=0.2`,
    `-s jerk_print=15`,
    `-s klipper_pressure_advance_factor=0.07`,
    `-s klipper_smooth_time_factor=0.05`,
    `-s line_width=0.44`,
    `-s material_final_print_temperature=245`,
    `-s material_flow=92.6`,
    `-s material_flow_layer_0=92`,
    `-s material_initial_print_temperature=255`,
    `-s material_print_temperature=255`,
    `-s material_print_temperature_layer_0=265.0`,
    `-s material_standby_temperature=180`,
    `-s prime_tower_flow=92`,
    `-s prime_tower_line_width=0.6`,
    `-s prime_tower_max_bridging_distance=8`,
    `-s prime_tower_min_volume=30`,
    `-s raft_airgap=0`,
    `-s raft_base_line_spacing=4`,
    `-s raft_base_margin=1.5`,
    `-s raft_base_thickness=0.7`,
    `-s raft_flow=86`,
    `-s raft_interface_layers=3`,
    `-s raft_interface_line_spacing=1`,
    `-s raft_interface_margin=3`,
    `-s raft_interface_speed=75`,
    `-s raft_interface_wall_count=1`,
    `-s raft_interface_z_offset=0`,
    `-s raft_margin=3`,
    `-s raft_surface_line_spacing=0.4`,
    `-s raft_surface_line_width=0.6`,
    `-s raft_surface_margin=2.8`,
    `-s raft_surface_speed=100`,
    `-s raft_surface_wall_count=1`,
    `-s retraction_amount=0.8`,
    `-s retraction_hop=0.8`,
    `-s retraction_hop_enabled=True`,
    `-s retraction_min_travel=2`,
    `-s retraction_speed=70`,
    `-s roofing_layer_count=4`,
    `-s roofing_material_flow=85`,
    `-s skin_line_width=0.4`,
    `-s skin_material_flow=91`,
    `-s skin_material_flow_layer_0=92.6`,
    `-s slicing_tolerance=inclusive`,
    `-s speed_infill=100`,
    `-s speed_layer_0=35`,
    `-s speed_print=130.0`,
    `-s speed_travel=250`,
    `-s speed_wall_0=55`,
    `-s speed_z_hop=300`,
    `-s support_angle=15`,
    `-s support_bottom_distance=0`,
    `-s support_infill_rate=10`,
    `-s support_initial_layer_line_distance=2`,
    `-s support_wall_count=1`,
    `-s switch_extruder_extra_prime_amount=0.5`,
    `-s switch_extruder_retraction_amount=20`,
    `-s top_bottom_pattern=zigzag`,
    `-s top_layers=4`,
    `-s wall_0_material_flow=89`,
    `-s wall_0_material_flow_layer_0=92`,
    `-s wall_0_material_flow_roofing=90`,
    `-s wall_line_count=2`,
    `-s wall_line_width_0=0.4`,
    `-s wall_material_flow=90`,
    `-s wall_thickness=0.8`,
    `-s wall_x_material_flow=89`,
    `-s wall_x_material_flow_layer_0=92.6`,
    `-s z_seam_corner=z_seam_corner_weighted`,
    `-s z_seam_position=frontleft`,
  
    // E1
    `-s infill_pattern=zigzag`,
    `-s infill_sparse_density=30`,
    `-s inset_direction=outside_in`,
    `-s ironing_enabled=False`,
    `-s material_final_print_temperature=240`,
    `-s material_flow=92.6`,
    `-s material_flow_layer_0=92.6`,
    `-s material_initial_print_temperature=240`,
    `-s material_print_temperature=255`,
    `-s material_print_temperature_layer_0=250`,
    `-s prime_tower_flow=92.6`,
    `-s prime_tower_max_bridging_distance=8`,
    `-s prime_tower_min_volume=30`,
    `-s prime_tower_raft_base_line_spacing=1.75`,
    `-s raft_airgap=0`,
    `-s raft_base_flow=94`,
    `-s raft_base_line_spacing=1`,
    `-s raft_base_line_width=1`,
    `-s raft_base_margin=3`,
    `-s raft_base_speed=50`,
    `-s raft_base_thickness=0.6`,
    `-s raft_interface_flow=90`,
    `-s raft_interface_layers=6`,
    `-s raft_interface_line_spacing=1.8`,
    `-s raft_interface_line_width=0.6`,
    `-s raft_interface_speed=100`,
    `-s raft_interface_thickness=0.4`,
    `-s raft_interface_wall_count=1`,
    `-s raft_margin=2`,
    `-s raft_surface_flow=90`,
    `-s raft_surface_infill_overlap=0.05`,
    `-s raft_surface_layers=1`,
    `-s raft_surface_line_spacing=0.5`,
    `-s raft_surface_line_width=0.6`,
    `-s raft_surface_margin=3`,
    `-s raft_surface_monotonic=True`,
    `-s raft_surface_speed=50`,
    `-s raft_surface_thickness=0.3`,
    `-s raft_surface_wall_count=0`,
    `-s retraction_amount=0.8`,
    `-s skin_material_flow=92.6`,
    `-s speed_support=50`,
    `-s support_angle=80`,
    `-s support_bottom_distance=0.0`,
    `-s support_infill_rate=15`,
    `-s support_interface_density=95`,
    `-s support_interface_enable=True`,
    `-s support_interface_height=1.2`,
    `-s support_interface_line_width=0.44`,
    `-s support_interface_material_flow=92`,
    `-s support_interface_pattern=zigzag`,
    `-s support_line_width=0.384`,
    `-s support_material_flow=92`,
    `-s support_roof_height=0.9`,
    `-s support_wall_count=1`,
    `-s support_z_distance=0.05`,
    `-s switch_extruder_extra_prime_amount=0.5`,
    `-s switch_extruder_retraction_amount=30`,
    `-s zig_zaggify_support=True`,
  ].join(" ");
  
  
let output;
try {
  output = execSync(command + " 2>&1", { encoding: "utf-8" });
  console.log("✅ CuraEngine başarılı:", output);
} catch (err) {
  console.error("❌ CuraEngine error:", err.message);
  
  // Detaylı hata bilgileri
  console.error("❌ CuraEngine stderr:", err.stderr);
  console.error("❌ CuraEngine stdout:", err.stdout); 
  console.error("❌ Exit code:", err.status);
  console.error("❌ Signal:", err.signal);
  console.error("❌ Command:", command);
  
  // Eğer stdout varsa onu da göster
  if (err.stdout) {
    console.error("❌ Full stdout output:");
    console.error(err.stdout);
  }
  
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