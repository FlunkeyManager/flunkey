import ReactDOM from "react-dom/client";
import App from "./App";

// No native context menus anywhere in the app (like production apps).
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
