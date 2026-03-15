# Oasis Patient Health Key

Export patient records to a **FHIR USB package** for offline viewing. The system reads your patient data (Oasis or FHIR format), builds a single-patient FHIR Bundle, and writes a self-contained folder you can copy to a USB drive. Patients or clinicians can open the record in any modern browser—no internet or installation required.

## Features

- **Dual input format**: Auto-detects and accepts either **Oasis** patient-record JSON or a **FHIR Bundle**
- **Offline viewer**: Generates a static HTML/CSS/JS viewer that runs entirely offline
- **FHIR-compliant**: Output uses [FHIR](https://www.hl7.org/fhir/) (Fast Healthcare Interoperability Resources) R4-style resources: Patient, Encounter, Observation, Condition, DocumentReference, Media
- **Media support**: Copies and links images, audio, and video from your record into a `media/` folder
- **Standalone executable**: Optional build produces a Windows `.exe` (Node 18) for use without Node.js installed

## Project structure

```
Oasis-USB/
├── export/
│   └── export-to-usb.js    # Main export script
├── OASIS_HEALTH_KEY/       # Viewer template (bundled into export)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── README.txt          # End-user instructions for the USB
├── package.json
├── README.md               # This file
└── (optional) patient-record.json   # Default input when present
```

## Requirements

- **Node.js** 18.x (for running the script or building the exe)
- **npm** (for `npm install` and `npm run build`)

## Installation

```bash
git clone <repo-url>
cd Oasis-USB
npm install
```

## Usage

### Export with Node.js

**Default** (reads `patient-record.json` in project root, writes to `OASIS_HEALTH_KEY/`):

```bash
npm run export
# or
node export/export-to-usb.js
```

**Custom input and/or output**:

```bash
node export/export-to-usb.js [input-path] [output-dir]
```

Examples:

```bash
node export/export-to-usb.js ./data/patient.json ./my-usb-folder
node export/export-to-usb.js ./fhir-bundle.json
```

- If no input file is found, the script uses built-in sample data.
- After a successful export, the default browser opens the viewer (`index.html`) automatically.

### Build standalone Windows executable

```bash
npm run build
```

This produces `dist/oasis-health-key-export.exe` (Node 18, Windows x64). Place the exe and your `patient-record.json` (or FHIR bundle) in the same folder, run the exe, and it will create an `OASIS_HEALTH_KEY` folder next to it.

### Viewing the exported record

1. Open the **output folder** (e.g. `OASIS_HEALTH_KEY`).
2. Double-click **`index.html`** (or open it with any modern browser).
3. The patient record loads from `fhir/bundle.json`; no server or internet needed.

## Input formats

### Oasis format

A JSON file (e.g. `patient-record.json`) with a `patient` object and optional `visits`, including:

- **patient**: `firstName`, `lastName`, `dateOfBirth`, `sex`, `phone`, `patientNumber`/`id`
- **patient.visits**: `chiefComplaint`, `visitedAt`, `bloodPressure`, `heartRate`, `temperature`, `diagnosis`, `staffName`, etc.
- **patient.media**: references to files (with `originalFilename`, `visitId`, `id`); files are resolved from `media/`, the input directory, or `uploads/`

The exporter converts this into a FHIR Bundle and copies any referenced media into the output `media/` folder.

### FHIR Bundle format

A JSON file with `resourceType: "Bundle"` and `entry[]` containing FHIR resources. Must include at least one **Patient**. DocumentReference and Media entries can reference local files (by path or relative path); the exporter copies those files into `media/` and rewrites URLs to `media/<filename>`.

## Output layout

After export, the target directory contains:

| Path | Description |
|------|-------------|
| `index.html` | Offline viewer entry point |
| `styles.css` | Viewer styles |
| `app.js` | FHIR parsing and UI logic |
| `README.txt` | Short instructions for the person using the USB |
| `fhir/bundle.json` | Single-patient FHIR Bundle (collection) |
| `fhir/bundle.js` | Same bundle as `window.FHIR_BUNDLE` for the viewer |
| `media/` | Images, audio, video referenced in the record |

## Technical notes

- The viewer is **read-only**; no edits are persisted.
- Data is stored as a FHIR R4-style Bundle; the viewer renders Patient, Encounters (visits), Observations (e.g. blood pressure, heart rate), Conditions, and DocumentReference/Media.
- When running as the pkg-built exe, paths are relative to the executable’s directory.

## License

See repository license information.
