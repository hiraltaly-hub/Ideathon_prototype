import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Allow JSON requests
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Serve index.html and other website files
app.use(express.static("."));

// Create uploads folder if it doesn't exist
const uploadDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Upload configuration
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

// OpenAI setup
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn("WARNING: OPENAI_API_KEY is missing from environment variables.");
}

const client = apiKey
  ? new OpenAI({ apiKey })
  : null;


// =====================================================
// PHOTO ANALYSIS
// =====================================================

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  let uploadedPath = null;

  try {
    if (!client) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing. Add it to Render Environment Variables."
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
- Analyze what is actually visible in the image.
- Do NOT assume a target asset selected by the user is correct.
- Do NOT use predefined/sample inspection results.
- Do NOT invent faults, measurements, or conditions.
- Only report problems supported by visible evidence.
- Field notes are supporting information; the image is the primary evidence.

Identify:

1. What asset is actually visible.
2. The asset subtype if identifiable.
3. Visible faults or abnormal conditions.
4. Severity of each fault.
5. Potential risk.
6. Recommended corrective action.
7. Overall condition score.
8. Overall inspection status.
9. Recommended next inspection interval.

If the image is unclear or there is not enough evidence, clearly say so.

FIELD NOTES:
${notes || "No field notes were provided."}

Return ONLY valid JSON.

Use exactly this structure:

{
  "assetType": "string",
  "assetSubtype": "string",
  "confidence": 0,
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

Choose the score based on the actual visible condition.
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
              detail: "low"
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
    } catch (error) {
      console.error("AI returned invalid JSON:");
      console.error(text);

      return res.status(502).json({
        error: "The AI returned an invalid inspection result."
      });
    }

    const safeResult = {
      assetType: String(result.assetType || "Unknown asset"),

      assetSubtype: String(
        result.assetSubtype || ""
      ),

      confidence: Number(
        result.confidence
      ) || 0,

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
        result.summary || "The image was analyzed."
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
        ? result.findings.map((finding) => ({
            title: String(
              finding?.title || "Visible condition"
            ),

            description: String(
              finding?.description || ""
            ),

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

            confidence: Number(
              finding?.confidence
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


// =====================================================
// VIDEO ANALYSIS
// =====================================================

function formatTime(seconds) {
  const totalSeconds = Math.max(
    0,
    Math.round(Number(seconds) || 0)
  );

  const minutes = Math.floor(
    totalSeconds / 60
  );

  const secs = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    secs
  ).padStart(2, "0")}`;
}


app.post("/api/analyze-video", async (req, res) => {

  try {

    if (!client) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing from Render Environment Variables."
      });
    }

    const frames = Array.isArray(
      req.body?.frames
    )
      ? req.body.frames
      : [];

    const notes = String(
      req.body?.notes || ""
    ).trim();

    if (!frames.length) {
      return res.status(400).json({
        error: "No video frames were provided."
      });
    }

    // Limit the number of frames so analysis stays reasonably fast
    const selectedFrames = frames.slice(0, 30);

    const availableTimestamps =
      selectedFrames
        .map(
          (frame) =>
            `Frame ${formatTime(frame.timestamp)}`
        )
        .join("\n");

    const content = [];

    content.push({
      type: "input_text",
      text: `
You are InspectIQ performing a REAL video inspection.

You are receiving frames extracted from one inspection video.

Each frame has a REAL timestamp supplied by the application.

Analyze the actual frames.

IMPORTANT RULES:

- Do NOT invent timestamps.
- Every finding timestamp MUST correspond to one of the supplied frame timestamps.
- Do NOT invent faults.
- Only report faults supported by visible evidence.
- If the same fault appears in multiple frames, choose the clearest frame.
- Describe WHERE the fault appears in the frame.
- Explain the potential risk.
- Give a corrective recommendation.
- Give severity and confidence.
- If there is insufficient evidence, say so.

The "location" should describe the visible position, for example:

"upper-left area of the frame"
"center-right near the pipe joint"
"bottom section of the transformer housing"

If possible, also provide a normalized bounding box:

x = left position from 0-1000
y = top position from 0-1000
width = box width from 0-1000
height = box height from 0-1000

FIELD NOTES:

${notes || "No field notes were provided."}

AVAILABLE FRAME TIMESTAMPS:

${availableTimestamps}

Return ONLY valid JSON using this structure:

{
  "summary": "string",
  "status": "Healthy | Attention | At risk | Critical",
  "score": 0,
  "confidence": 0,
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
    });

    for (const frame of selectedFrames) {

      if (!frame?.dataUrl) {
        continue;
      }

      content.push({
        type: "input_image",
        image_url: frame.dataUrl,
        detail: "low"
      });

      content.push({
        type: "input_text",
        text: `This frame corresponds to timestamp ${formatTime(
          frame.timestamp
        )}.`
      });
    }

    const response =
      await client.responses.create({

        model: "gpt-5.6-luna",

        input: [
          {
            role: "user",
            content
          }
        ]
      });

    const text =
      response.output_text || "";

    const cleaned =
      text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    let result;

    try {
      result = JSON.parse(cleaned);
    } catch (error) {

      console.error(
        "AI returned invalid video JSON:"
      );

      console.error(text);

      return res.status(502).json({
        error:
          "The AI returned an invalid video inspection result."
      });
    }

    // Only allow timestamps that actually came from the uploaded frames
    const validTimestamps =
      selectedFrames.map(
        (frame) =>
          Number(frame.timestamp)
      );

    const safeFindings =
      Array.isArray(result.findings)
        ? result.findings.map(
            (finding) => {

              let timestamp =
                Number(
                  finding?.timestamp
                );

              // Find the closest REAL frame timestamp
              if (
                !validTimestamps.includes(
                  timestamp
                )
              ) {

                timestamp =
                  validTimestamps.reduce(
                    (
                      closest,
                      current
                    ) =>
                      Math.abs(
                        current - timestamp
                      ) <
                      Math.abs(
                        closest - timestamp
                      )
                        ? current
                        : closest,
                    validTimestamps[0]
                  );
              }

              return {

                title: String(
                  finding?.title ||
                  "Visible condition"
                ),

                description: String(
                  finding?.description ||
                  ""
                ),

                timestamp,

                location: String(
                  finding?.location ||
                  ""
                ),

                severity: String(
                  finding?.severity ||
                  "Minor"
                ),

                risk: String(
                  finding?.risk ||
                  ""
                ),

                recommendation: String(
                  finding?.recommendation ||
                  ""
                ),

                confidence:
                  Number(
                    finding?.confidence
                  ) || 0,

                box:
                  finding?.box &&
                  typeof finding.box ===
                    "object"
                    ? {
                        x:
                          Number(
                            finding.box.x
                          ) || 0,

                        y:
                          Number(
                            finding.box.y
                          ) || 0,

                        width:
                          Number(
                            finding.box.width
                          ) || 0,

                        height:
                          Number(
                            finding.box.height
                          ) || 0
                      }
                    : null
              };
            }
          )
        : [];

    return res.json({

      summary: String(
        result.summary ||
        "The video was analyzed."
      ),

      status: String(
        result.status ||
        "Attention"
      ),

      score: Math.max(
        0,
        Math.min(
          100,
          Number(result.score) || 0
        )
      ),

      confidence:
        Number(
          result.confidence
        ) || 0,

      recommendation: String(
        result.recommendation ||
        "Review the detected conditions."
      ),

      nextInspectionInterval: String(
        result.nextInspectionInterval ||
        "Further inspection recommended."
      ),

      findings: safeFindings
    });

  } catch (error) {

    console.error(
      "Video inspection error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "The video inspection could not be completed."
    });
  }
});


// =====================================================
// UPLOAD ERROR HANDLER
// =====================================================

app.use(
  (error, req, res, next) => {

    if (
      error instanceof
      multer.MulterError
    ) {

      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {

        return res.status(400).json({
          error:
            "The uploaded file is too large. Maximum size is 100 MB."
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
  }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `InspectIQ running on port ${PORT}`
    );

  }
);
