console.log("Autofill content script loaded");

type AutofillInstruction = {
  css_selector: string;
  value: string;
  type: "input" | "select";
};

type AutofillMessage = {
  type?: string;
  instructions?: AutofillInstruction[];
};

// Run whenever the extension sends a message
// Listener gets set up with content script loads
chrome.runtime.onMessage.addListener((message: AutofillMessage) => {
  console.log("Content script received message:", message);

  if (message?.type !== "AUTOFILL") return;

  const instructions = message?.instructions;

  if (!Array.isArray(instructions)) {
    console.error("AUTOFILL message is missing a valid instructions array:", message);
    return;
  }

  // For each instruction, fill in the value according to the css_selector
  instructions.forEach(({ css_selector, value, type }) => {
    // Find the element
    const el = document.querySelector(css_selector) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;

    if (!el) {
      console.warn("Element not found for selector:", css_selector);
      return;
    }

    if (type === "select" && el instanceof HTMLSelectElement) {
      el.focus(); // Focus field
      el.value = value; // Set value
      el.dispatchEvent(new Event("change", { bubbles: true })); // Trigger event by making it seem the user typed it in. Bubbles: true lets the event propagate up the DOM
      el.blur(); // Unfocus
      return;
    }

    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    }
  });
});