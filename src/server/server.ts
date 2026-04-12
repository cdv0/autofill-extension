import express from "express";
import cors from "cors";
import { generateText, tool } from "ai";
import { model } from "./_internal/setup";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/autofill", async (req, res) => {
  const { html, screenshot, fields } = req.body;

  const json_input: Record<string, string> = {};
  fields.forEach(({ label, value }: { label: string; value: string }) => {
    json_input[label] = value;
  });

  const instructions: { css_selector: string; value: string; type: "input" | "select" }[] = [];

  const tools = {
    fill_form_input: tool({
      description: "Fill one or more input fields at once.",
      parameters: z.object({
        fields: z.array(
          z.object({
            css_selector: z.string().describe("The CSS selector used to identify the input element."),
            value: z.string().describe("Value to fill in."),
          })
        ),
      }),
      execute: async ({ fields }) => {
        const results = [];
        for (const { css_selector, value } of fields) {
          instructions.push({ css_selector, value, type: "input" });
          results.push(`${css_selector}: ${value}`)
        }
        return results.join("\n");
      },
    }),
    fill_form_dropdown: tool({
      description: "Fill out one or more dropdown (select) fields at once.",
      parameters: z.object({
        fields: z.array(
          z.object({
            value: z.string().describe("The answer to the form's dropdown field."),
            css_selector: z.string().describe("The CSS selector used to identify this form dropdown's element."),
          })
        )
      }),
      execute: async ({ fields }) => {
        const results = [];
        for (const { css_selector, value } of fields) {
          instructions.push({ css_selector, value, type: "select" });
          results.push(`${css_selector}: ${value}`)
        }
        return results.join("\n");
      }
    }),
    done: tool({
      description: "Call this tool only after all fields are identified. This will signal that the workflow is completed. Do not call any tools after this.",
      parameters: z.object({}),
      execute: async (): Promise<string> => {
        console.log("Finished workflow");
        return "done";
      }
    })
  }

  try {
    await generateText({
      model,
      maxSteps: 20,
      tools,
      toolChoice: "required",
      system: `
        You are filling out various forms. 
        You must fill out the form using the user's relevant data: ${JSON.stringify(json_input)}
        
        Rules:
          1. Fill all visible input fields in a single fill_form_input call. Do NOT fill one field at a time.
          2. Fill all visible dropdowns (select) in a single fill_form_dropdowns call. Check the available options, and pick the matching value.
          3. Only fill fields that have a corresponding value in the patient data. If a field has no matching data, leave it blank. Do not substitute other data or make values up.
          4. Do not call done until every applicable field is identified.
          5. Once all fields are identified, call done.
          `,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: Buffer.from(screenshot.split(",")[1], "base64") },
            {
              type: "text",
              text: `HTML: ${html}`
            }
          ]
        }
      ]
    });

    res.json({ instructions });
  } catch (err: any) {
    console.error("Error: ", err);
    res.status(500).json({ error: "Failed to process" });
  }
});

app.listen(3000, () => console.log("Autofill server running on port 3000"));