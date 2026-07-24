// Browser entry for the FayrAppV3 web prototype. This exists ONLY to run the
// React-DOM prototype (and its live-logic Verifier screen) in a browser — the
// real app is React Native under src/. esbuild bundles this to bundle.js.
import React from "react";
import { createRoot } from "react-dom/client";
import FayrApp from "../fayr-design.browser.jsx";

createRoot(document.getElementById("root")).render(<FayrApp />);
