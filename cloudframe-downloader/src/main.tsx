import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./task-actions.css";
import "./conveyor-motion.css";
import "./task-pods.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
