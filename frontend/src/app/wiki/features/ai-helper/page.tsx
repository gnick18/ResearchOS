import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function AiHelperFeaturePage() {
  return (
    <WikiPage
      title="Use any AI with your data"
      intro="Because your notebook is plain files on your own disk, the AI you already use can read it. ResearchOS ships a built-in AI Helper, a prompt that teaches any model how your data is structured, so it can draft entries, cross-reference protocols, and answer questions about your own work. This page covers both ways to use it, pasting into a chat assistant and pointing an agent at your folder."
    >
      <Callout title="Why this works here and not in a cloud notebook">
        Your projects, notes, and protocols are ordinary JSON and Markdown files
        in a folder you control, so any AI can read them. A cloud notebook stores
        your data on its servers, encrypted at rest, behind its own login, so no
        outside AI can reach it and you are left with whatever assistant the
        vendor bundles. Owning your files means owning your choice of AI too.
      </Callout>

      <h2>The AI Helper prompt</h2>
      <p>
        Open Settings and find the AI Helper section. It gives you a
        schema-aware prompt, a block of text that explains how a ResearchOS
        folder is laid out (where notes, experiments, methods, and projects
        live, and what each file looks like). Hand that to any model and it
        understands your data without you explaining the structure every time.
      </p>
      <p>You choose a size to fit the model you are using.</p>
      <ul>
        <li>
          <strong>Minimal</strong> (around 6k tokens) is for tiny windows or
          small local models.
        </li>
        <li>
          <strong>Lean</strong> (around 21k tokens) fits most chat windows.
        </li>
        <li>
          <strong>Full</strong> (around 42k tokens) is best for drafting on
          big-context models like Claude, GPT-5, or Gemini 2.5 Pro.
        </li>
      </ul>
      <Screenshot
        src="/wiki/screenshots/settings-ai-helper.png"
        alt="The AI Helper section in Settings, with size options and one-click buttons to open the prompt in Claude, ChatGPT, Gemini, or Copilot."
        caption="The AI Helper in Settings. Pick a size, copy the prompt, or open it straight in your provider."
      />

      <h2>Flow 1: paste into a chat assistant</h2>
      <p>
        The simplest way. No setup, works with any chat AI, and nothing leaves
        your machine except the text you choose to paste.
      </p>
      <Steps>
        <Step>
          <strong>Copy the prompt.</strong> In Settings, pick a size and click
          copy, or use the one-click button to open it directly in Claude,
          ChatGPT, Gemini, or Copilot. (Microsoft Copilot is free with many
          university accounts.)
        </Step>
        <Step>
          <strong>Paste in your data or your question.</strong> Paste the prompt,
          then paste the note or experiment you want help with, or just ask.
          Because the prompt taught the model your schema, it knows what a
          running-log note or a PCR method looks like and can draft in the same
          shape.
        </Step>
        <Step>
          <strong>Bring the result back.</strong> Copy the model&apos;s draft
          back into the matching field in ResearchOS. You stay in control of
          what gets saved.
        </Step>
      </Steps>

      <h2>Flow 2: point an agent at your folder</h2>
      <p>
        The more powerful way. An agentic tool with read access to your data
        folder can work across your whole notebook at once, no copy-paste. Give
        it the AI Helper prompt plus access to the folder and it can draft
        entries, fill in notes, and cross-reference protocols alongside you.
      </p>
      <p>This works with any tool that can read a local folder, for example:</p>
      <ul>
        <li>
          A coding agent like Claude Code or Cursor, opened on your data folder.
        </li>
        <li>
          A filesystem MCP server, so an assistant can list and read your files.
        </li>
        <li>
          A local model (via Ollama, LM Studio, and the like) pointed at the
          folder, so your data never leaves your machine at all.
        </li>
      </ul>
      <Callout title="A good starting prompt">
        Paste the AI Helper prompt, then: &quot;You have read access to my
        ResearchOS folder. Read project 3, summarize what is left to do, and
        draft a running-log entry for today&apos;s qPCR run from these Cq
        values...&quot; The agent reads the real files and drafts in your
        notebook&apos;s format.
      </Callout>

      <h2>What it can and cannot do</h2>
      <p>
        An AI can <strong>read</strong> anything in the folder you give it access
        to, and <strong>draft</strong> content for you to place. Whether it can{" "}
        <strong>write</strong> files depends on the tool: a paste-flow chat AI
        only suggests text you copy back, while a folder-access agent can write
        files directly if you let it. Treat agent drafts like a collaborator&apos;s,
        review before you rely on them, and lean on{" "}
        <Link href="/wiki/features/version-history">version history</Link> so you
        can always see and undo what changed.
      </p>

      <Callout title="Your machine, your call">
        None of this uploads your research anywhere unless you choose a
        cloud-hosted model and paste data into it. A local model or a local
        folder-access agent keeps everything on your own computer. The choice,
        and the data, stay yours.
      </Callout>
    </WikiPage>
  );
}
