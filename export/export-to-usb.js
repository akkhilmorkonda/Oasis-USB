/**
 * Oasis Patient Health Key — Export to USB
 *
 * Reads input file (patient-record.json by default) and exports to a FHIR Bundle
 * for the offline viewer. Auto-detects format: Oasis or FHIR.
 *
 * Usage:
 *   node export-to-usb.js
 *   node export-to-usb.js [input-path]
 *   node export-to-usb.js [input-path] [output-dir]
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// When running as pkg exe (USB), use exe directory. Otherwise use project root.
const isExe = !!process.pkg;
const baseDir = isExe ? path.dirname(process.execPath) : path.join(__dirname, '..');

const VIEWER_FILES = ['index.html', 'styles.css', 'app.js', 'README.txt'];
const DEFAULT_INPUT = path.join(baseDir, 'patient-record.json');
const DEFAULT_OUTPUT = path.join(baseDir, 'OASIS_HEALTH_KEY');

function detectFormat(data) {
  if (data && data.resourceType === 'Bundle' && Array.isArray(data.entry)) {
    return 'fhir';
  }
  if (data && data.patient && typeof data.patient === 'object') {
    return 'oasis';
  }
  return null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyViewerFiles(targetDir) {
  // pkg keeps assets in snapshot at package structure; __dirname works for both node and exe
  const viewerSrc = path.join(__dirname, '..', 'OASIS_HEALTH_KEY');
  for (const file of VIEWER_FILES) {
    const src = path.join(viewerSrc, file);
    const dst = path.join(targetDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log('  Copied', file);
    }
  }
}

/**
 * Process FHIR Bundle: validate, copy media files, normalize URLs to media/.
 * Returns the modified bundle.
 */
function processFhirBundle(bundle, inputDir, mediaDir) {
  const hasPatient = bundle.entry.some(
    (e) => e.resource && e.resource.resourceType === 'Patient'
  );
  if (!hasPatient) {
    throw new Error('FHIR Bundle must contain at least one Patient resource');
  }

  for (const entry of bundle.entry) {
    const r = entry.resource;
    if (!r) continue;

    if (r.resourceType === 'DocumentReference' && r.content) {
      for (const c of r.content) {
        const att = c.attachment;
        if (att && att.url && !att.url.startsWith('http')) {
          const fileName = path.basename(att.url);
          const srcPath = path.isAbsolute(att.url)
            ? att.url
            : (() => {
                const candidates = [
                  path.join(inputDir, att.url),
                  path.join(inputDir, '..', 'media', fileName),
                ];
                return candidates.find((p) => fs.existsSync(p)) || candidates[0];
              })();
          const destPath = path.join(mediaDir, fileName);
          if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log('  Copied media/', fileName);
          }
          att.url = `media/${fileName}`;
        }
      }
    } else if (r.resourceType === 'Media' && r.content) {
      const att = r.content;
      if (att.url && !att.url.startsWith('http')) {
        const fileName = path.basename(att.url);
        const srcPath = path.isAbsolute(att.url)
          ? att.url
          : (() => {
              const candidates = [
                path.join(inputDir, att.url),
                path.join(inputDir, '..', 'media', fileName),
              ];
              return candidates.find((p) => fs.existsSync(p)) || candidates[0];
            })();
        const destPath = path.join(mediaDir, fileName);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          console.log('  Copied media/', fileName);
        }
        att.url = `media/${fileName}`;
      }
    }
  }

  return bundle;
}

function buildFhirBundle(patient, encounters, observations, conditions, mediaFiles) {
  const entries = [];

  entries.push({
    resource: {
      resourceType: 'Patient',
      id: patient.id,
      name: patient.name ? [{ family: patient.name.family, given: patient.name.given, use: 'official' }] : [],
      birthDate: patient.birthDate,
      gender: patient.gender,
      telecom: patient.telecom || [],
    },
  });

  for (const e of encounters || []) {
    entries.push({
      resource: {
        resourceType: 'Encounter',
        id: e.id,
        status: e.status || 'finished',
        type: e.type ? [{ text: e.type }] : [],
        period: e.period,
        subject: { reference: `Patient/${patient.id}` },
        participant: e.participant || [],
      },
    });
  }

  for (const o of observations || []) {
    const obs = {
      resourceType: 'Observation',
      id: o.id,
      status: 'final',
      code: { text: o.code },
      subject: { reference: `Patient/${patient.id}` },
      effectiveDateTime: o.effectiveDateTime,
      valueQuantity: o.valueQuantity,
      component: o.component,
    };
    if (o.encounterRef) obs.encounter = { reference: `Encounter/${o.encounterRef}` };
    entries.push({ resource: obs });
  }

  for (const c of conditions || []) {
    const cond = {
      resourceType: 'Condition',
      id: c.id,
      clinicalStatus: { coding: [{ display: c.status || 'Active' }] },
      code: { text: c.code },
      subject: { reference: `Patient/${patient.id}` },
      onsetDateTime: c.onsetDateTime,
    };
    if (c.encounterRef) cond.encounter = { reference: `Encounter/${c.encounterRef}` };
    entries.push({ resource: cond });
  }

  for (const m of mediaFiles || []) {
    const fileName = path.basename(m.path);
    if (m.type === 'DocumentReference') {
      const docRef = {
        resourceType: 'DocumentReference',
        status: 'current',
        description: m.description || fileName,
        content: [
          {
            attachment: {
              contentType: m.contentType,
              url: `media/${fileName}`,
              title: m.title || fileName,
            },
          },
        ],
      };
      if (m.encounterRef) docRef.context = { encounter: { reference: `Encounter/${m.encounterRef}` } };
      entries.push({ resource: docRef });
    } else {
      const mediaRes = {
        resourceType: 'Media',
        status: 'completed',
        type: { text: m.mediaType || 'document' },
        content: {
          contentType: m.contentType,
          url: `media/${fileName}`,
          title: m.title || fileName,
        },
        subject: { reference: `Patient/${patient.id}` },
      };
      if (m.encounterRef) mediaRes.encounter = { reference: `Encounter/${m.encounterRef}` };
      entries.push({ resource: mediaRes });
    }
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: entries,
  };
}

/**
 * Convert Oasis patient-record.json format to the internal format for buildFhirBundle.
 */
function convertOasisToFhir(record, inputDir) {
  // Visit-associated media files live in a folder named "media"
  const mediaSearchDirs = [
    path.join(inputDir, 'media'),
    inputDir,
    path.join(inputDir, 'uploads'),
  ];
  const p = record.patient;
  if (!p) throw new Error('Invalid patient record: missing patient');

  const patientId = String(p.patientNumber || p.id || 'patient-001');
  const genderMap = { F: 'female', M: 'male', male: 'male', female: 'female' };

  const patient = {
    id: patientId,
    name: {
      family: p.lastName || '',
      given: p.firstName ? [p.firstName] : [],
    },
    birthDate: p.dateOfBirth || p.dateofBirth,
    gender: genderMap[p.sex] || p.sex || 'unknown',
    telecom: p.phone ? [{ system: 'phone', value: p.phone, use: 'home' }] : [],
  };

  const encounters = [];
  const observations = [];
  const conditions = [];
  const mediaFiles = [];

  for (const v of p.visits || []) {
    const encId = `enc-${v.id}`;
    const visitDate = v.visitedAt || v.createdAt || new Date().toISOString();

    encounters.push({
      id: encId,
      status: 'finished',
      type: v.chiefComplaint || 'Visit',
      period: { start: visitDate, end: visitDate },
      participant: v.staffName ? [{ individual: { display: v.staffName } }] : [],
    });

    if (v.bloodPressure) {
      const [sys, dia] = String(v.bloodPressure).split('/').map((n) => parseInt(n.trim(), 10) || 0);
      observations.push({
        id: `obs-bp-${v.id}`,
        code: 'Blood pressure',
        effectiveDateTime: visitDate,
        encounterRef: encId,
        valueQuantity: { value: sys, unit: 'mmHg' },
        component: [
          { code: { text: 'Systolic' }, valueQuantity: { value: sys, unit: 'mmHg' } },
          { code: { text: 'Diastolic' }, valueQuantity: { value: dia, unit: 'mmHg' } },
        ],
      });
    }
    if (v.heartRate != null) {
      observations.push({
        id: `obs-hr-${v.id}`,
        code: 'Heart rate',
        effectiveDateTime: visitDate,
        encounterRef: encId,
        valueQuantity: { value: Number(v.heartRate), unit: 'bpm' },
      });
    }
    if (v.temperature != null) {
      observations.push({
        id: `obs-temp-${v.id}`,
        code: 'Body temperature',
        effectiveDateTime: visitDate,
        encounterRef: encId,
        valueQuantity: { value: Number(v.temperature), unit: '°C' },
      });
    }
    if (v.diagnosis && v.diagnosis !== 'Unknown.') {
      conditions.push({
        id: `cond-${v.id}`,
        code: v.diagnosis,
        onsetDateTime: visitDate,
        encounterRef: encId,
      });
    }
  }

  const extToContentType = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };

  for (const m of p.media || []) {
    const filename = m.originalFilename || `media-${m.id}`;
    const ext = path.extname(filename).slice(1).toLowerCase();
    const contentType = extToContentType[ext] || 'application/octet-stream';

    // URL structure: /api/patients/{patientId}/visits/{visitId}/media/{mediaId}/file
    // File naming may mirror this. Try most specific first so mapping is unambiguous.
    const filenameVariants = [filename];
    if (m.id != null) filenameVariants.unshift(`${m.id}-${filename}`);
    if (m.visitId != null && m.id != null) filenameVariants.unshift(`${m.visitId}-${m.id}-${filename}`);
    if (patientId && m.visitId != null && m.id != null) filenameVariants.unshift(`${patientId}-${m.visitId}-${m.id}-${filename}`);

    let foundPath = null;
    for (const dir of mediaSearchDirs) {
      for (const variant of filenameVariants) {
        const candidate = path.join(dir, variant);
        if (fs.existsSync(candidate)) {
          foundPath = candidate;
          break;
        }
      }
      if (foundPath) break;
    }
    if (!foundPath) {
      foundPath = path.join(inputDir, 'media', filename);
    }

    const visitId = m.visitId;
    const encounterRef = visitId ? `enc-${visitId}` : null;
    mediaFiles.push({
      type: 'Media',
      path: foundPath,
      contentType,
      title: filename,
      mediaType: m.mediaType || (extToContentType[ext] ? 'photo' : 'document'),
      encounterRef,
    });
  }

  return {
    patient,
    encounters,
    observations,
    conditions,
    mediaFiles,
  };
}

function exportToUsb(outputDir, bundle, mediaFilesToCopy = []) {
  ensureDir(outputDir);
  const fhirDir = path.join(outputDir, 'fhir');
  const mediaDir = path.join(outputDir, 'media');
  ensureDir(fhirDir);
  ensureDir(mediaDir);

  copyViewerFiles(outputDir);

  const bundlePath = path.join(fhirDir, 'bundle.json');
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  console.log('  Wrote fhir/bundle.json');

  const bundleJsPath = path.join(fhirDir, 'bundle.js');
  fs.writeFileSync(bundleJsPath, `window.FHIR_BUNDLE = ${JSON.stringify(bundle)};`);
  console.log('  Wrote fhir/bundle.js');

  for (const m of mediaFilesToCopy) {
    const fileName = path.basename(m.path);
    const dest = path.join(mediaDir, fileName);
    if (fs.existsSync(m.path)) {
      fs.copyFileSync(m.path, dest);
      console.log('  Copied media/', fileName);
    }
  }

  console.log('\nExport complete:', outputDir);

  // Auto-launch index.html in default browser
  const indexPath = path.join(outputDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    const url = 'file:///' + indexPath.replace(/\\/g, '/');
    const cmd = process.platform === 'win32'
      ? `start "" "${indexPath}"`
      : process.platform === 'darwin'
        ? `open "${indexPath}"`
        : `xdg-open "${url}"`;
    exec(cmd, (err) => {
      if (err) console.log('  (Could not open viewer automatically)');
    });
  }
}

// Demo: fallback when no patient-record.json
const sampleData = {
  patient: {
    id: 'patient-001',
    name: { family: 'Smith', given: ['Jane', 'Marie'] },
    birthDate: '1985-03-22',
    gender: 'female',
    telecom: [{ system: 'phone', value: '(555) 123-4567', use: 'home' }],
  },
  encounters: [
    {
      id: 'enc-001',
      status: 'finished',
      type: 'Annual checkup',
      period: { start: '2024-02-15T09:00:00Z', end: '2024-02-15T09:45:00Z' },
      participant: [{ individual: { display: 'Dr. Sarah Chen' } }],
    },
  ],
  observations: [
    {
      id: 'obs-bp',
      code: 'Blood pressure',
      effectiveDateTime: '2024-02-15T09:15:00Z',
      valueQuantity: { value: 118, unit: 'mmHg' },
      component: [
        { code: { text: 'Systolic' }, valueQuantity: { value: 118, unit: 'mmHg' } },
        { code: { text: 'Diastolic' }, valueQuantity: { value: 76, unit: 'mmHg' } },
      ],
    },
  ],
  conditions: [{ id: 'cond-001', code: 'Hypertension', onsetDateTime: '2020-06-01' }],
  mediaFiles: [
    {
      type: 'Media',
      path: path.join(__dirname, '..', 'OASIS_HEALTH_KEY', 'media', 'image_001.png'),
      contentType: 'image/png',
      title: 'Wound photo',
    },
  ],
};

// Parse positional args: [input-path] [output-dir]
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const inputPath = args[0] ? path.resolve(args[0]) : DEFAULT_INPUT;
const outDir = args[1] ? path.resolve(args[1]) : path.resolve(DEFAULT_OUTPUT);

let bundle;
let mediaFilesToCopy = [];

if (fs.existsSync(inputPath)) {
  console.log('Reading', path.basename(inputPath) + '...');
  const record = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const format = detectFormat(record);

  if (format === 'fhir') {
    console.log('  Detected: FHIR Bundle');
    const inputDir = path.dirname(inputPath);
    const mediaDir = path.join(outDir, 'media');
    ensureDir(mediaDir);
    bundle = processFhirBundle(record, inputDir, mediaDir);
  } else if (format === 'oasis') {
    console.log('  Detected: Oasis format');
    const inputDir = path.dirname(inputPath);
    const data = convertOasisToFhir(record, inputDir);
    bundle = buildFhirBundle(
      data.patient,
      data.encounters,
      data.observations,
      data.conditions,
      data.mediaFiles
    );
    mediaFilesToCopy = data.mediaFiles;
    const p = data.patient;
    console.log('  Patient:', (p.name?.given?.[0] || '') + ' ' + (p.name?.family || ''));
  } else {
    throw new Error('Unrecognized format. Expected FHIR Bundle or Oasis patient record.');
  }
} else {
  console.log('No input file found, using sample data.');
  bundle = buildFhirBundle(
    sampleData.patient,
    sampleData.encounters,
    sampleData.observations,
    sampleData.conditions,
    sampleData.mediaFiles
  );
  mediaFilesToCopy = sampleData.mediaFiles;
}

console.log('Exporting to:', outDir);
exportToUsb(outDir, bundle, mediaFilesToCopy);
