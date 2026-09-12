import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Serve index.html from this same folder
app.use(express.static("."));

const uploadDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn("WARNING: OPENAI_API_KEY is missing from .env");
}

const client = apiKey
  ? new OpenAI({ apiKey })
  : null;


// ----------------------------------------------------
// PHOTO INSPECTION
// ----------------------------------------------------

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  let uploadedPath = null;

  try {
    if (!client) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing from .env"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Please upload an image."
      });
    }

    uploadedPath = req.file.path;

    const notes = String(req.body?.notes || "").trim();

    const imageBase64 = fs
      .readFileSync(uploadedPath)
      .toString("base64");

    const mimeType = req.file.mimetype || "image/jpeg";

    const prompt = `
You are InspectIQ, a visual inspection AI.

Analyze ONLY what is actually visible in the uploaded image.

Do not trust:
- dropdown selections
- filenames
- predefined assets
- previous results

The image is the primary evidence.

Identify the visible asset and any visible faults.

Do NOT invent:
- measurements
- damage
- defects
- causes
- hidden conditions

For every visible finding provide:
- fault/condition
- description
- approximate visible location
- severity
- risk
- corrective action
- confidence

Also provide:
- asset type
- asset subtype
- overall condition score
- status
- summary
- recommended action
- next inspection interval

FIELD NOTES:
${notes || "No field notes supplied."}

Return ONLY JSON:

{
  "assetType": "string",
  "assetSubtype": "string",
  "confidence": 0,
  "score": 0,
  "status": "Healthy | Attention | At risk | Critical",
  "summary": "string",
  "recommendation": "string",
  "nextInspectionInterval": "string",
  "findings": [
    {
      "title": "string",
      "description": "string",
      "location": "string",
      "severity": "Minor | Moderate | Major | Critical",
      "risk": "string",
      "recommendation": "string",
      "confidence": 0
    }
  ]
}

Score:
90-100 Healthy
75-89 Attention
50-74 At risk
0-49 Critical
`;

    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${imageBase64}`,
              detail: "low"
            }
          ]
        }
      ]
    });

    const result = parseAIJson(response.output_text);

    return res.json(cleanResult(result));

  } catch (error) {
    console.error("PHOTO INSPECTION ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Photo inspection failed."
    });

  } finally {
    if (uploadedPath) {
      fs.unlink(uploadedPath, () => {});
    }
  }
});


// ----------------------------------------------------
// VIDEO INSPECTION
// ----------------------------------------------------

app.post("/api/analyze-video", async (req, res) => {

  try {

    if (!client) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing from .env"
      });
    }

    const frames = Array.isArray(req.body?.frames)
      ? req.body.frames
      : [];

    const notes = String(req.body?.notes || "").trim();

    if (!frames.length) {
      return res.status(400).json({
        error: "No video frames were supplied."
      });
    }

    // Limit the number of frames for speed.
    const selectedFrames = frames.slice(0, 30);

    const frameInstructions = selectedFrames
      .map((frame, index) => {
        return `Frame ${index + 1}: timestamp ${formatTime(frame.timestamp)}`;
      })
      .join("\n");

    const content = [
      {
        type: "input_text",
        text: `
You are InspectIQ performing a REAL video inspection.

You are receiving frames extracted from one inspection video.

Each frame has a real timestamp supplied by the application.

Analyze the actual frames.

IMPORTANT:
Do not invent timestamps.

Only report a timestamp from one of the supplied frames.

For every visible fault:
- identify the fault
- give its timestamp
- describe where it appears in the frame
- give severity
- explain risk
- recommend corrective action
- give confidence

If the same fault appears in several frames, choose the clearest frame.

The "location" should describe the position in the image,
for example:
"lower-left portion of the frame near the pipe joint"
or
"upper-right side of the machine housing".

If possible also provide normalized bounding box coordinates:
x, y, width, height
where the image is treated as 0-1000.

Do not claim a fault if the frames do not provide enough visual evidence.

FIELD NOTES:
${notes || "No field notes supplied."}

AVAILABLE FRAME TIMESTAMPS:
${frameInstructions}

Return ONLY JSON:

{
  "assetType": "string",
  "assetSubtype": "string",
  "confidence": 0,
  "score": 0,
  "status": "Healthy | Attention | At risk | Critical",
  "summary": "string",
  "recommendation": "string",
  "nextInspectionInterval": "string",
  "findings": [
    {
      "title": "string",
      "description": "string",
      "timestamp": 0,
      "location": "string",
      "severity": "Minor | Moderate | Major | Critical",
      "risk": "string",
      "recommendation": "string",
      "confidence": 0,
      "box": {
        "x": 0,
        "y": 0,
        "width": 0,
        "height": 0
      }
    }
  ]
}
`
      }
    ];

    for (const frame of selectedFrames) {

      if (!frame.dataUrl) continue;

      content.push({
        type: "input_image",
        image_url: frame.dataUrl,
        detail: "low"
      });

      content.push({
        type: "input_text",
        text: `This frame corresponds to timestamp ${formatTime(frame.timestamp)}.`
      });
    }

    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "user",
          content
        }
      ]
    });

    const result = parseAIJson(response.output_text);

    const cleaned = cleanResult(result);

    cleaned.findings = Array.isArray(cleaned.findings)
      ? cleaned.findings.map((finding) => ({
          ...finding,
          timestamp: Number(finding.timestamp) || 0,
          box: finding.box || null
        }))
      : [];

    return res.json(cleaned);

  } catch (error) {

    console.error("VIDEO INSPECTION ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Video inspection failed."
    });
  }
});


// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------

function parseAIJson(text) {

  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error("AI returned invalid JSON:");
    console.error(text);

    throw new Error(
      "The AI returned an invalid inspection result."
    );
  }
}


function cleanResult(result) {

  return {
    assetType: String(
      result?.assetType || "Unknown asset"
    ),

    assetSubtype: String(
      result?.assetSubtype || ""
    ),

    confidence: clamp(
      Number(result?.confidence) || 0,
      0,
      100
    ),

    score: clamp(
      Number(result?.score) || 0,
      0,
      100
    ),

    status: String(
      result?.status || "Attention"
    ),

    summary: String(
      result?.summary || "No summary was returned."
    ),

    recommendation: String(
      result?.recommendation ||
      "Review the detected condition."
    ),

    nextInspectionInterval: String(
      result?.nextInspectionInterval ||
      "Further inspection recommended based on condition."
    ),

    findings: Array.isArray(result?.findings)
      ? result.findings.map((finding) => ({
          title: String(
            finding?.title || "Visible condition"
          ),

          description: String(
            finding?.description || ""
          ),

          timestamp:
            finding?.timestamp !== undefined
              ? Number(finding.timestamp)
              : null,

          location: String(
            finding?.location || ""
          ),

          severity: String(
            finding?.severity || "Minor"
          ),

          risk: String(
            finding?.risk || ""
          ),

          recommendation: String(
            finding?.recommendation || ""
          ),

          confidence: clamp(
            Number(finding?.confidence) || 0,
            0,
            100
          ),

          box: finding?.box || null
        }))
      : []
  };
}


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function formatTime(seconds) {

  const total = Math.max(
    0,
    Math.floor(Number(seconds) || 0)
  );

  const minutes = Math.floor(total / 60);
  const secs = total % 60;

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}


// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `InspectIQ running on http://localhost:${PORT}`
  );
});
