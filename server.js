import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();

const PORT = 3000;


/* ==========================================
   UPLOAD CONFIGURATION
========================================== */

const upload =
  multer({
    dest: "uploads/",
    limits: {
      fileSize: 50 * 1024 * 1024
    }
  });


/* ==========================================
   SERVE YOUR HTML
========================================== */

app.use(
  express.static(".")
);


/* ==========================================
   AI INSPECTION
========================================== */

app.post(
  "/api/analyze",
  upload.single("image"),
  async (req, res) => {

    if (!req.file) {

      return res
        .status(400)
        .json({
          error: "No image uploaded."
        });

    }


    try {

      /*
       * Read the actual uploaded image.
       */

      const image =
        fs.readFileSync(
          req.file.path
        );


      const base64 =
        image.toString("base64");


      const mimeType =
        req.file.mimetype;


      const notes =
        req.body.notes || "";


      /*
       * THIS is the instruction sent
       * to the vision AI.
       */

      const prompt = `

You are InspectIQ, an AI visual inspection assistant.

Analyze the uploaded image carefully.

IMPORTANT:

The uploaded photograph is the PRIMARY source
of information.

Do NOT assume that the image is a predefined
asset.

Do NOT reuse previous inspection results.

Do NOT invent faults.

First determine what type of asset is actually
visible in the photograph.

Possible asset types include:

- building
- bridge
- civil structure
- industrial machinery
- electrical equipment
- transformer
- pipeline
- tank
- vehicle
- road
- construction equipment
- other

Then inspect the visible condition.

Identify ONLY faults or abnormalities that are
reasonably supported by the image.

For every finding provide:

- title
- description
- approximate location
- severity
- potential risk
- recommended solution
- confidence

Severity must be one of:

Critical
High
Medium
Low

Then calculate an overall condition score
from 0 to 100.

100 means apparently healthy based on visible
evidence.

0 means extremely poor / critical condition.

Also provide:

- overall status
- summary
- immediate recommended action
- next inspection interval
- reason for that interval

The inspection interval MUST be based on the
severity and condition identified in THIS IMAGE.

Do not simply use a predefined number.

If the image does not provide enough information
to determine something, explicitly say so.

FIELD NOTES:

${notes}

Return ONLY valid JSON.

Use exactly this structure:

{
  "asset": {
    "type": "",
    "subtype": "",
    "confidence": 0,
    "reason": ""
  },

  "condition": {
    "score": 0,
    "status": "",
    "summary": ""
  },

  "findings": [
    {
      "title": "",
      "description": "",
      "location": "",
      "severity": "",
      "risk": "",
      "recommendation": "",
      "confidence": 0
    }
  ],

  "recommendation": {
    "immediate_action": "",
    "next_inspection_interval": "",
    "inspection_reason": ""
  }
}

`;


      /*
       * ------------------------------------------------
       * AI PROVIDER CALL GOES HERE
       * ------------------------------------------------
       *
       * Replace this section with your AI provider.
       *
       */


      const result =
        await analyzeWithAI(
          prompt,
          base64,
          mimeType
        );


      /*
       * Send AI result back to browser.
       */

      res.json(result);


      /*
       * Delete temporary image.
       */

      fs.unlink(
        req.file.path,
        () => {}
      );


    } catch (error) {

      console.error(
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message ||
            "AI analysis failed."
        });

    }

  }
);


/* ==========================================
   AI FUNCTION
========================================== */

async function analyzeWithAI(
  prompt,
  base64Image,
  mimeType
) {

  const OpenAI = (await import("openai")).default;

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });


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
            image_url:
              `data:${mimeType};base64,${base64Image}`,

            detail: "high"
          }

        ]

      }

    ]

  });


  /*
   * OpenAI returns the model's text here.
   */

  const text =
    response.output_text;


  /*
   * Remove accidental markdown fences
   * if the model puts ```json around it.
   */

  const cleaned =
    text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();


  /*
   * Convert the AI response into real JSON.
   */

  let result;

  try {

    result =
      JSON.parse(cleaned);

  } catch (error) {

    console.error(
      "AI returned invalid JSON:"
    );

    console.error(text);

    throw new Error(
      "The AI returned an invalid inspection result."
    );

  }


  return result;

}


/* ==========================================
   START SERVER
========================================== */

app.listen(
  PORT,
  () => {

    console.log(
      `InspectIQ running on http://localhost:${PORT}`
    );

  }
);
