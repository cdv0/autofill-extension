// UI content for extension
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

interface Group {
  group_id: string;
  name: string;
}

interface AutofillInstruction {
  css_selector: string;
  value: string;
  type: "input" | "select";
}

const Popup = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Everytime the component mounts, initialize the current session and subscripe to auth changes, and udpate the session whenever it changes
  // Use effect runs once, but it sets up this listener once. After that, it'll update as needed
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session); // Runs every time auth state changes
    });

    return () => subscription.unsubscribe(); // Clean up when the component unmounts, NOT when useEffect finishes
  }, []);

  // Load in groups from supabase
  useEffect(() => {
    if (!session) return;

    const loadGroups = async () => {
      const { data, error } = await supabase.from("groups").select("*");

      if (error) {
        setError("Failed to load groups.");
        return;
      }

      setGroups(data ?? []);
      if (data && data.length > 0) {
        setSelectedGroupId(data[0].group_id);
      }
    };

    loadGroups();
  }, [session]);

  // Sign in function
  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setAuthError(error.message);
    }

    setAuthLoading(false);
  };

  // Log out funciton
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setGroups([]);
    setSelectedGroupId("");
    setStatus("");
    setError("");
  };

  // Autofill function
  const handleAutofill = async () => {
    if (!selectedGroupId) return;

    setLoading(true);
    setError("");
    setStatus("");

    try {
      if (!BACKEND_URL) {
        setError("Missing VITE_BACKEND_URL.");
        return;
      }

      // Gets the currently active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        setError("No active tab found.");
        return;
      }

      console.log("Active tab:", tab);

      setStatus("Reading form...");

      // Runs code in the page
      // Grabs a string list of all relevant form inputs and returns it
      const scriptResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const forms = Array.from(document.querySelectorAll("form")).map((form) => form.outerHTML);

          if (forms.length > 0) {
            return forms.join("\n");
          }

          const fields = Array.from(
            document.querySelectorAll("input, textarea, select") // Gets all the input fields on the page and turns them into an array
          ).map((el) => { // el = element from the page e.g. <input>, <textarea>, <select>
            // Loops through each field and extracts the id, name, placeholder, and type
            const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            const id = input.id ? `#${input.id}` : "";
            const name = input.getAttribute("name") ?? "";
            const placeholder = input.getAttribute("placeholder") ?? "";
            const type = input.getAttribute("type") ?? "";
            return `<field tag="${input.tagName.toLowerCase()}" id="${id}" name="${name}" type="${type}" placeholder="${placeholder}"></field>`;
          });

          return fields.join("\n"); // Returns a big string of all fields <field ...></field> <field .../><field>
        },
      });

      // Relevant html of the page
      const html = scriptResults?.[0]?.result;

      if (typeof html !== "string" || !html) {
        setError("Failed to read form HTML.");
        return;
      }

      console.log("Form HTML length:", html.length);

      setStatus("Fetching fields...");

      // Grab data from supabase
      const { data: fields, error: fieldsError } = await supabase
        .from("group_fields")
        .select("*")
        .eq("group_id", selectedGroupId);

      console.log("Fields:", fields);
      console.log("Fields error:", fieldsError);

      if (fieldsError) {
        setError("Failed to fetch fields.");
        return;
      }

      if (!fields || fields.length === 0) {
        setError("No fields found for this group.");
        return;
      }

      setStatus("Matching fields...");
      console.log("Sending to backend:", BACKEND_URL);

      // Send both the user's data and the page html to backend
      const geminiRes = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, fields }),
      });

      console.log("Backend response status:", geminiRes.status);

      let result: any;
      try {
        result = await geminiRes.json();
      } catch (jsonErr) {
        console.error("Failed to parse backend JSON:", jsonErr);
        setError("Backend did not return valid JSON.");
        return;
      }

      console.log("Backend result:", result);

      if (!geminiRes.ok) {
        setError(result?.error || `Backend failed (${geminiRes.status}).`);
        return;
      }

      // Backend sends back instructions telling what in the form to fill and where
      const instructions: AutofillInstruction[] | undefined = result?.instructions;
      console.log("Instructions:", instructions);

      if (!Array.isArray(instructions)) {
        setError("Backend returned invalid instructions.");
        return;
      }

      if (instructions.length === 0) {
        setStatus("No matching fields found.");
        return;
      }

      setStatus("Filling page...");

      // Start filling out the form with relevant user data
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "AUTOFILL",
          instructions,
        });
      } catch (messageErr) {
        console.error("sendMessage failed:", messageErr);
        setError("Could not reach content script on this page.");
        return;
      }

      setStatus("Done!");
    } catch (err) {
      console.error("Autofill error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  // Auth page
  if (!session) {
    return (
      <div
        style={{
          width: 300,
          padding: 16,
          fontFamily: "sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h3 style={{ fontWeight: 600, fontSize: 16 }}>Autofill Assistant</h3>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            padding: "8px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: 14,
          }}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: "8px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: 14,
          }}
        />

        <button
          onClick={handleLogin}
          disabled={authLoading}
          style={{
            padding: 10,
            background: "#23334A",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 500,
            opacity: authLoading ? 0.5 : 1,
          }}
        >
          {authLoading ? "Logging in..." : "Log in"}
        </button>

        {authError && <p style={{ fontSize: 13, color: "#BA1618" }}>{authError}</p>}
      </div>
    );
  }

  // Autofill button page
  return (
    <div
      style={{
        width: 300,
        padding: 16,
        fontFamily: "sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontWeight: 600, fontSize: 16 }}>Autofill Assistant</h3>
        <button
          onClick={handleLogout}
          style={{
            fontSize: 12,
            color: "#42608B",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          Log out
        </button>
      </div>

      <select
        value={selectedGroupId}
        onChange={(e) => setSelectedGroupId(e.target.value)}
        style={{
          padding: "8px",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          fontSize: 14,
        }}
      >
        {groups.map((g) => (
          <option key={g.group_id} value={g.group_id}>
            {g.name}
          </option>
        ))}
      </select>

      <button
        onClick={handleAutofill}
        disabled={loading || !selectedGroupId}
        style={{
          padding: 10,
          background: "#23334A",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 500,
          opacity: loading ? 0.5 : 1,
        }}
      >
        Autofill this page
      </button>

      {status && <p style={{ fontSize: 13, color: "#42608B" }}>{status}</p>}
      {error && <p style={{ fontSize: 13, color: "#BA1618" }}>{error}</p>}
    </div>
  );
};

export default Popup;