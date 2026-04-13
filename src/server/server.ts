// server.ts is the backend API that uses AI to match form fields and return autofill instructions

import "dotenv/config";
import express from "express";
import cors from "cors";
import { generateText, tool } from "ai";
import { model } from "./internal/setup.ts";
import { z } from "zod";

// Sets up server. Creates API server. Allows requests from extension. Parses JSON body.
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/autofill", async (req, res) => { // Endpoint called
  const { html, fields } = req.body ?? {};

  console.log("Incoming /autofill request");
  console.log("Has html:", typeof html === "string");
  console.log("Fields:", fields);

  if (typeof html !== "string" || !html) {
    return res.status(400).json({ error: "Missing or invalid html" });
  }

  if (!Array.isArray(fields)) {
    return res.status(400).json({ error: "Missing or invalid fields array" });
  }

  const jsonInput: Record<string, string> = {};
  fields.forEach((field: any) => {
    if (field && typeof field.label === "string" && typeof field.value === "string") {
      jsonInput[field.label] = field.value;
    }
  });

  console.log("jsonInput:", jsonInput);

  const instructions: {
    css_selector: string;
    value: string;
    type: "input" | "select";
  }[] = [];

  // Tool declaration
  const tools = {
    fill_form_input: tool({
      description: "Fill one or more input or textarea fields at once.",
      parameters: z.object({
        fields: z.array(
          z.object({
            css_selector: z.string().describe("CSS selector for the input or textarea element."),
            value: z.string().describe("Value to fill."),
          })
        ),
      }),
      execute: async ({ fields }) => {
        console.log("fill_form_input called with:", fields);

        for (const { css_selector, value } of fields) {
          instructions.push({ css_selector, value, type: "input" });
        }

        return "Filled input fields.";
      },
    }),

    fill_form_dropdown: tool({
      description: "Fill one or more select dropdowns at once.",
      parameters: z.object({
        fields: z.array(
          z.object({
            css_selector: z.string().describe("CSS selector for the select element."),
            value: z.string().describe("Option value to choose."),
          })
        ),
      }),
      execute: async ({ fields }) => {
        console.log("fill_form_dropdown called with:", fields);

        for (const { css_selector, value } of fields) {
          instructions.push({ css_selector, value, type: "select" });
        }

        return "Filled dropdown fields.";
      },
    }),

    done: tool({
      description: "Call this only after all applicable fields are identified.",
      parameters: z.object({}),
      execute: async () => {
        console.log("done called");
        return "done";
      },
    }),
  };

  // Gemini API call to execute autofill
  try {
    const result = await generateText({
      model,
      maxSteps: 2,
      tools,
      toolChoice: "required",
      system: `
        You are matching saved user data to a web form.

        User data:
        ${JSON.stringify(jsonInput, null, 2)}

        Rules:
        1. Work fast.
        2. Use only the provided HTML.
        3. Fill all matching input and textarea fields in one fill_form_input call.
        4. Fill all matching select fields in one fill_form_dropdown call.
        5. Only fill fields with a clear match.
        6. Do not invent values.
        7. After identifying all matching fields, call done.
        8. Prefer stable selectors like id, name, or other direct selectors.
      `,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Form HTML:\n${html}`,
            },
          ],
        },
      ],
    });

    console.log("generateText result:", result);
    console.log("Final instructions:", instructions);

    return res.json({ instructions });
  } catch (err: any) {
    console.error("Autofill backend error:", err);

    return res.status(500).json({
      error: err?.message || "Failed to process",
      details: err?.cause || null,
    });
  }
});

app.listen(3000, () => {
  console.log("Autofill server running on port 3000");
});