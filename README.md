# FieldLens inspection prototype

This package preserves the original FieldLens prototype and adds **working clickable navigation** between the inspection, analysis/results, and report screens.

## Navigation change

- **New inspection** → `#capture` (inspection/capture screen)
- **Analyze inspection** → `#dashboard` (inspection results/findings screen)
- **Reports** → `#report` (report screen)
- The dashboard's **Generate report** button also routes to the report screen.
- The report's **Back to inspection** button returns to the results/dashboard screen.
- The selected sidebar item follows the current screen.

The existing visual styling and prototype functionality are otherwise preserved.

## Run locally

Because camera/microphone capture requires a secure browser context, do not open `index.html` directly with `file://` when testing camera capture. Run the folder from localhost or deploy it to HTTPS.

For example, with Python installed:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/` in Chrome or Edge.

## Demo flow

1. Choose Equipment, Industrial system, Structure, or Large component.
2. Enter an asset ID.
3. Use Camera & voice, upload photo/video/audio, or choose Use demo inspection.
4. Review the evidence-linked findings, repair target, and suggested re-inspection date.
5. Generate the report and use Print / save PDF.

## Prototype note

AI findings are illustrative/demo output until a backend AI service is connected. Production use should connect media storage, transcription, visual analysis, structured findings, and organization-specific maintenance/re-inspection rules. Findings should be reviewed by a qualified person before being used for safety, compliance, or maintenance decisions.
