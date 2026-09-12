import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve index.html from the same folder as server.js
app.use(express.static("."));

const uploadDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Please upload an image file."));
    }
  }
});

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn("WARNING: OPENAI_API_KEY is missing from .env");
}

const client = apiKey
  ? new OpenAI({ apiKey })
  : null;

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  let uploadedPath = null;

  try {
    if (!client) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing. Add it to your .env file."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Please upload an image first."
      });
    }

    uploadedPath = req.file.path;

    const notes = String(req.body?.notes || "").trim();

    const base64Image = fs
      .readFileSync(uploadedPath)
      .toString("base64");

    const mimeType = req.file.mimetype || "image/jpeg";

    const prompt = `
You are InspectIQ, an AI visual inspection assistant.

Analyze the uploaded inspection image itself.

IMPORTANT:
Do NOT assume that the target dropdown, filename, field notes,
or predefined asset list is correct.

The IMAGE is the primary evidence.

Identify what is actually visible in the image.

Detect only faults or conditions supported by visible evidence.
Do not invent defects, measurements, damage, or information.

Determine:

- what asset is visible
- asset subtype if possible
- visible faults or conditions
- severity
- potential risk
- recommended corrective action
- condition score
- overall status
- recommended next inspection interval

If the image is unclear or there is not enough evidence,
clearly say so.

FIELD NOTES:
${notes || "No field notes were provided."}

Return ONLY valid JSON in exactly this structure:

{
  "assetType": "string",
  "assetSubtype": "string",
  "confidence": 0,
  "reason": "string",
  "score": 0,
  "status": "Healthy | Attention | At risk | Critical",
  "summary": "string",
  "recommendation": "string",
  "nextInspectionInterval": "string",
  "inspectionReason": "string",
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

Scoring guidance:

90-100 = Healthy
75-89 = Attention
50-74 = At risk
0-49 = Critical

Choose the score from the actual visible condition.
Do not use a fixed score.
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
              image_url: `data:${mimeType};base64,${base64Image}`,
              detail: "high"
            }
          ]
        }
      ]
    });

    const text = response.output_text || "";

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let result;

    try {
      result = JSON.parse(cleaned);
    } catch {
      console.error("AI returned invalid JSON:");
      console.error(text);

      return res.status(502).json({
        error: "The AI returned an invalid inspection result."
      });
    }

    const safeResult = {
      assetType: String(
        result.assetType || "Unknown asset"
      ),

      assetSubtype: String(
        result.assetSubtype || ""
      ),

      confidence: Number(
        result.confidence
      ) || 0,

      reason: String(
        result.reason || ""
      ),

      score: Math.max(
        0,
        Math.min(
          100,
          Number(result.score) || 0
        )
      ),

      status: String(
        result.status || "Attention"
      ),

      summary: String(
        result.summary ||
        "The image was analyzed."
      ),

      recommendation: String(
        result.recommendation ||
        "Review the visible condition and perform appropriate follow-up inspection."
      ),

      nextInspectionInterval: String(
        result.nextInspectionInterval ||
        "Further inspection recommended based on site conditions."
      ),

      inspectionReason: String(
        result.inspectionReason || ""
      ),

      findings: Array.isArray(result.findings)
        ? result.findings.map((f) => ({
            title: String(
              f?.title || "Visible condition"
            ),

            description: String(
              f?.description || ""
            ),

            location: String(
              f?.location || ""
            ),

            severity: String(
              f?.severity || "Minor"
            ),

            risk: String(
              f?.risk || ""
            ),

            recommendation: String(
              f?.recommendation || ""
            ),

            confidence: Number(
              f?.confidence
            ) || 0
          }))
        : []
    };

    return res.json(safeResult);

  } catch (error) {
    console.error("Inspection error:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "The inspection could not be completed."
    });

  } finally {
    if (uploadedPath) {
      fs.unlink(uploadedPath, () => {});
    }
  }
});

app.use((error, req, res, next) => {

  if (error instanceof multer.MulterError) {

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "The image is too large. Maximum size is 50 MB."
      });
    }

    return res.status(400).json({
      error: error.message
    });
  }

  if (error) {
    return res.status(400).json({
      error:
        error.message ||
        "Upload failed."
    });
  }

  next();
});

app.listen(PORT, () => {
  console.log(
    `InspectIQ running on http://localhost:${PORT}`
  );
});
