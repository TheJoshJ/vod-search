import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/plus-jakarta-sans"
import "@fontsource-variable/lora"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./styles.css"
import { App } from "./App.js"

async function bootstrap(): Promise<void> {
  if (!window.vodSearch && import.meta.env.DEV) {
    const { createDevMockApi } = await import("./dev-mock.js")
    window.vodSearch = createDevMockApi()
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
