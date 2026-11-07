import { useApp } from "./store";

/** "问讲解员": open the assistant and ask about the primer. */
export function askTutor(text: string) {
  const st = useApp.getState();
  if (!st.assistantOpen) st.toggleAssistant();
  setTimeout(() => window.dispatchEvent(new CustomEvent("assistant-ask", { detail: text })), 60);
}
